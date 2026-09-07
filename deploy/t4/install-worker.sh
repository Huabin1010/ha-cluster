#!/usr/bin/env bash
# T4 · Join a worker from a T3 payload (read-only). Does not rebuild packaging/.
# Usage:
#   sudo ./install-worker.sh /var/cache/ha-payload \
#     --token 'ha://join/...' \
#     --fabric-ip 10.88.0.11 \
#     --power battery \
#     --class phone \
#     --name ginkgo
set -euo pipefail

PAYLOAD_DIR=""
TOKEN=""
FABRIC_IP="10.88.0.11"
POWER="mains"
CLASS="desktop"
NODE_NAME="$(hostname)"
ROLE="worker"
ROOT_DIR="/var/lib/ha-setup"
SKIP_ET="${HA_SKIP_EASYTIER:-0}"
SKIP_K3S="${HA_SKIP_K3S:-0}"

usage() {
  echo "usage: $0 PAYLOAD_DIR --token URL [--fabric-ip IP] [--power mains|battery] [--class phone|desktop] [--name NAME]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
PAYLOAD_DIR="$1"; shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --fabric-ip) FABRIC_IP="$2"; shift 2 ;;
    --power) POWER="$2"; shift 2 ;;
    --class) CLASS="$2"; shift 2 ;;
    --name) NODE_NAME="$2"; shift 2 ;;
    --role) ROLE="$2"; shift 2 ;;
    --root) ROOT_DIR="$2"; shift 2 ;;
    --skip-easytier) SKIP_ET=1; shift ;;
    --skip-k3s) SKIP_K3S=1; shift ;;
    *) usage ;;
  esac
done

[[ -n "${TOKEN}" ]] || usage
[[ -d "${PAYLOAD_DIR}" ]] || { echo "payload dir missing" >&2; exit 1; }
[[ -f "${PAYLOAD_DIR}/manifest.json" ]] || { echo "manifest.json missing — refuse (T3)" >&2; exit 1; }

arch="$(python3 -c "import json;print(json.load(open('${PAYLOAD_DIR}/manifest.json'))['arch'])")"
machine="$(uname -m)"
case "${machine}" in
  x86_64) machine=amd64 ;;
  aarch64) machine=arm64 ;;
esac
if [[ "${arch}" != "${machine}" ]]; then
  echo "REFUSE wrong payload: manifest.arch=${arch} uname=${machine}" >&2
  exit 1
fi

if [[ -x "${PAYLOAD_DIR}/ha-setup" ]]; then
  install -m 0755 "${PAYLOAD_DIR}/ha-setup" /usr/local/bin/ha-setup
fi
if [[ -x "${PAYLOAD_DIR}/ha-agent" ]]; then
  install -m 0755 "${PAYLOAD_DIR}/ha-agent" /usr/local/bin/ha-agent
else
  echo "ha-agent missing in payload" >&2
  exit 1
fi

# Optional: EasyTier from payload (do not invent a new network name)
if [[ "${SKIP_ET}" != "1" ]]; then
  if [[ -x "${PAYLOAD_DIR}/easytier-core" ]]; then
    install -m 0755 "${PAYLOAD_DIR}/easytier-core" /usr/local/bin/easytier-core
  else
    echo "warn: easytier-core not in payload; use --skip-easytier for LAN-only debug" >&2
  fi
fi

ha-setup join --token "${TOKEN}" --root "${ROOT_DIR}" --role "${ROLE}" \
  --power "${POWER}" --class "${CLASS}" --fabric-ip "${FABRIC_IP}"

# Rewrite node name into join.env for systemd
if ! grep -q '^HA_NODE_NAME=' "${ROOT_DIR}/join.env" 2>/dev/null; then
  echo "HA_NODE_NAME=${NODE_NAME}" >>"${ROOT_DIR}/join.env"
fi

# Install Incus from payload debs if present; otherwise leave a clear error for T3.
if ! command -v incus >/dev/null 2>&1; then
  if compgen -G "${PAYLOAD_DIR}/debs/*.deb" >/dev/null; then
    dpkg -i "${PAYLOAD_DIR}"/debs/*.deb || apt-get -f install -y
  else
    echo "warn: incus not installed and no debs/ in payload — Path A / container ops need Incus" >&2
  fi
fi

# Import workspace image if exported in payload
if compgen -G "${PAYLOAD_DIR}/images/*" >/dev/null; then
  for img in "${PAYLOAD_DIR}"/images/*; do
    incus image import "${img}" --alias ha-ubuntu || true
  done
fi

# k3s agent (requires T2 + VPS k3s server)
if [[ "${SKIP_K3S}" != "1" ]]; then
  K3S_URL="$(grep '^HA_K3S=' "${ROOT_DIR}/join.env" | cut -d= -f2-)"
  if [[ -z "${K3S_URL}" ]]; then
    echo "warn: HA_K3S empty in join token — skip k3s agent" >&2
  else
    K3S_BIN=""
    for c in k3s k3s-agent; do
      [[ -x "${PAYLOAD_DIR}/${c}" ]] && K3S_BIN="${PAYLOAD_DIR}/${c}" && break
    done
    if [[ -z "${K3S_BIN}" ]]; then
      echo "k3s binary missing — ask T3 (or --skip-k3s)" >&2
      exit 1
    fi
    install -m 0755 "${K3S_BIN}" /usr/local/bin/k3s
    if compgen -G "${PAYLOAD_DIR}/k3s-airgap-images-*.tar*" >/dev/null; then
      mkdir -p /var/lib/rancher/k3s/agent/images
      cp -n "${PAYLOAD_DIR}"/k3s-airgap-images-*.tar* /var/lib/rancher/k3s/agent/images/ || true
    fi
    if [[ ! -f /var/lib/rancher/k3s/server/node-token && -z "${K3S_TOKEN:-}" ]]; then
      echo "Set K3S_TOKEN from VPS /var/lib/rancher/k3s/server/node-token" >&2
      exit 1
    fi
    export INSTALL_K3S_SKIP_DOWNLOAD=true
    export K3S_URL
    export K3S_TOKEN="${K3S_TOKEN:?need K3S_TOKEN}"
    export INSTALL_K3S_EXEC="agent --node-ip=${FABRIC_IP} --node-label kubernetes.io/arch=${arch} --node-label ha-cluster.mnnumath.vip/power=${POWER} --node-label ha-cluster.mnnumath.vip/class=${CLASS}"
    if [[ -x "${PAYLOAD_DIR}/install-k3s.sh" ]]; then
      bash "${PAYLOAD_DIR}/install-k3s.sh"
    else
      cat >/etc/systemd/system/k3s-agent.service <<EOF
[Unit]
Description=k3s agent (ha-cluster T4)
After=network-online.target
Wants=network-online.target

[Service]
Environment=K3S_URL=${K3S_URL}
Environment=K3S_TOKEN=${K3S_TOKEN}
ExecStart=/usr/local/bin/k3s ${INSTALL_K3S_EXEC}
Restart=always

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      systemctl enable --now k3s-agent
    fi
  fi
fi

# systemd ha-agent
UNIT_SRC="${ROOT_DIR}/ha-agent.service"
if [[ -f /opt/ha-cluster/deploy/ha-agent.service ]]; then
  UNIT_SRC=/opt/ha-cluster/deploy/ha-agent.service
fi
install -m 0644 "${UNIT_SRC}" /etc/systemd/system/ha-agent.service
# Ensure ExecStart uses name
mkdir -p /etc/systemd/system/ha-agent.service.d
cat >/etc/systemd/system/ha-agent.service.d/override.conf <<EOF
[Service]
Environment=HA_NODE_NAME=${NODE_NAME}
ExecStart=
ExecStart=/usr/local/bin/ha-agent --api \${HA_API} --name \${HA_NODE_NAME} --fabric-ip \${HA_FABRIC_IP} --power \${HA_POWER} --class \${HA_CLASS}
EOF

if [[ "${SKIP_ET}" != "1" && -f "${ROOT_DIR}/easytier.service" ]]; then
  install -m 0644 "${ROOT_DIR}/easytier.service" /etc/systemd/system/easytier.service
  systemctl daemon-reload
  systemctl enable --now easytier || true
fi

systemctl daemon-reload
systemctl enable --now ha-agent

echo "worker ${NODE_NAME} joined. fabric=${FABRIC_IP} power=${POWER} class=${CLASS}"
echo "Check: systemctl status ha-agent ; journalctl -u ha-agent -n 50"
