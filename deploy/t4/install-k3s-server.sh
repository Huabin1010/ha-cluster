#!/usr/bin/env bash
# T4 · Install k3s server on VPS (bind EasyTier IP only). Do not touch OpenResty / ha-api.
# Requires: T2 EasyTier up (10.88.0.1), T3 payload with k3s binary.
set -euo pipefail

PAYLOAD_DIR="${1:-}"
NODE_IP="${K3S_NODE_IP:-10.88.0.1}"
FLANNEL_IFACE="${K3S_FLANNEL_IFACE:-easytier}"
INSTALL_DIR="${K3S_INSTALL_DIR:-/usr/local/bin}"

if [[ -z "${PAYLOAD_DIR}" || ! -d "${PAYLOAD_DIR}" ]]; then
  echo "usage: $0 /path/to/payload-linux-amd64" >&2
  exit 2
fi

if [[ ! -f "${PAYLOAD_DIR}/manifest.json" ]]; then
  echo "missing manifest.json — refuse unsigned/empty payload (get from T3)" >&2
  exit 1
fi

arch="$(python3 -c "import json;print(json.load(open('${PAYLOAD_DIR}/manifest.json'))['arch'])")"
machine="$(uname -m)"
case "${machine}" in
  x86_64) machine=amd64 ;;
  aarch64) machine=arm64 ;;
esac
if [[ "${arch}" != "${machine}" ]]; then
  echo "arch mismatch: payload=${arch} machine=${machine}" >&2
  exit 1
fi

if ! ip -4 addr show | grep -q "${NODE_IP}"; then
  echo "ERROR: ${NODE_IP} not present. Finish T2 EasyTier before binding k3s." >&2
  exit 1
fi

K3S_BIN=""
for c in k3s k3s-amd64 k3s-arm64; do
  if [[ -x "${PAYLOAD_DIR}/${c}" ]]; then
    K3S_BIN="${PAYLOAD_DIR}/${c}"
    break
  fi
done
if [[ -z "${K3S_BIN}" ]]; then
  echo "k3s binary missing in payload — ask T3" >&2
  exit 1
fi

install -m 0755 "${K3S_BIN}" "${INSTALL_DIR}/k3s"

# Airgap images if present
if compgen -G "${PAYLOAD_DIR}/k3s-airgap-images-*.tar*" >/dev/null; then
  mkdir -p /var/lib/rancher/k3s/agent/images
  cp -n "${PAYLOAD_DIR}"/k3s-airgap-images-*.tar* /var/lib/rancher/k3s/agent/images/ || true
fi

export INSTALL_K3S_SKIP_DOWNLOAD=true
export INSTALL_K3S_EXEC="server --node-ip=${NODE_IP} --bind-address=${NODE_IP} --tls-san=${NODE_IP} --flannel-iface=${FLANNEL_IFACE} --disable=traefik --node-taint CriticalAddonsOnly=true:NoSchedule"

if [[ -x "${PAYLOAD_DIR}/install-k3s.sh" ]]; then
  INSTALL_K3S_BIN="${INSTALL_DIR}/k3s" bash "${PAYLOAD_DIR}/install-k3s.sh"
elif [[ -x /usr/local/bin/k3s ]]; then
  # Minimal systemd unit if airgap installer script absent
  cat >/etc/systemd/system/k3s.service <<EOF
[Unit]
Description=k3s server (ha-cluster T4)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${INSTALL_DIR}/k3s ${INSTALL_K3S_EXEC}
Restart=always
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now k3s
else
  echo "no install-k3s.sh in payload and k3s not installed" >&2
  exit 1
fi

echo "k3s server started. Check: kubectl get nodes ; ss -ltn | grep 6443"
echo "Confirm security group does NOT expose 6443 to the public internet."
