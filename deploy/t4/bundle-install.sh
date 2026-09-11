#!/usr/bin/env bash
# T4 · One-click worker install from a worker-bundle directory.
#
#   sudo ./install.sh \
#     --token 'ha://join/...' \
#     --fabric-ip 10.88.0.11 \
#     --name ginkgo \
#     --power battery \
#     --class phone
#
# LAN-only debug:
#   sudo ./install.sh ... --skip-easytier --skip-k3s
#   # optional: --api-override http://192.168.1.148:8080
#
# Env: SUDO_PASSWORD, K3S_TOKEN, HA_INCUS_IMAGE (default ha-ubuntu-24.04)
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
ORIG_ARGS=("$@")

if [[ "$(id -u)" -ne 0 ]]; then
  if [[ -n "${SUDO_PASSWORD:-}" ]]; then
    echo "${SUDO_PASSWORD}" | sudo -S -v
    # Avoid sudo -E (disabled on some hosts); pass only needed vars.
    exec sudo K3S_TOKEN="${K3S_TOKEN:-}" HA_INCUS_IMAGE="${HA_INCUS_IMAGE:-}" \
      bash "$0" "${ORIG_ARGS[@]}"
  fi
  echo "run as root or set SUDO_PASSWORD" >&2
  exit 1
fi

TOKEN=""
FABRIC_IP=""
POWER="mains"
CLASS="desktop"
NODE_NAME="$(hostname)"
ROLE="worker"
ROOT_DIR="/var/lib/ha-setup"
SKIP_ET=0
SKIP_K3S=0
API_OVERRIDE=""
VERIFY_ONLY=0

usage() {
  cat >&2 <<'EOF'
usage: install.sh --token URL --fabric-ip IP [--name NAME] [--power mains|battery]
                  [--class phone|desktop] [--skip-easytier] [--skip-k3s]
                  [--api-override URL] [--verify-only]
EOF
  exit 2
}

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
    --api-override) API_OVERRIDE="$2"; shift 2 ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done

[[ -n "${TOKEN}" ]] || { echo "--token required" >&2; usage; }
[[ -n "${FABRIC_IP}" ]] || { echo "--fabric-ip required" >&2; usage; }
[[ -f "${BUNDLE_DIR}/manifest.json" ]] || { echo "manifest.json missing in ${BUNDLE_DIR}" >&2; exit 1; }

arch_manifest="$(python3 -c "import json;print(json.load(open('${BUNDLE_DIR}/manifest.json'))['arch'])")"
machine="$(uname -m)"
case "${machine}" in
  x86_64) machine=amd64 ;;
  aarch64) machine=arm64 ;;
esac
if [[ "${arch_manifest}" != "${machine}" ]]; then
  echo "REFUSE: manifest.arch=${arch_manifest} host=${machine}" >&2
  exit 1
fi

echo "==> verify critical checksums"
(
  cd "${BUNDLE_DIR}"
  grep -E ' (ha-agent|ha-setup|install\.sh|manifest\.json)$' SHA256SUMS | sha256sum -c -
)

if [[ "${VERIFY_ONLY}" == "1" ]]; then
  echo "verify-only OK"
  exit 0
fi

echo "==> install binaries"
install -m 0755 "${BUNDLE_DIR}/ha-agent" /usr/local/bin/ha-agent
install -m 0755 "${BUNDLE_DIR}/ha-setup" /usr/local/bin/ha-setup

if [[ "${SKIP_ET}" != "1" ]]; then
  if [[ -x "${BUNDLE_DIR}/easytier-core" ]]; then
    install -m 0755 "${BUNDLE_DIR}/easytier-core" /usr/local/bin/easytier-core
  elif [[ -x "${BUNDLE_DIR}/easytier/easytier-core" ]]; then
    install -m 0755 "${BUNDLE_DIR}/easytier/easytier-core" /usr/local/bin/easytier-core
  else
    echo "warn: easytier-core not in bundle"
    SKIP_ET=1
  fi
fi

if ! command -v incus >/dev/null 2>&1; then
  if compgen -G "${BUNDLE_DIR}/debs/*/*.deb" >/dev/null; then
    echo "==> dpkg debs from bundle"
    dpkg -i "${BUNDLE_DIR}"/debs/*/*.deb 2>/dev/null || apt-get -f install -y || true
  fi
  if ! command -v incus >/dev/null 2>&1; then
    echo "==> apt install incus"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y incus
  fi
fi

if ! incus info >/dev/null 2>&1; then
  if ! incus admin init --auto 2>/dev/null; then
    cat >/tmp/ha-incus-preseed.yaml <<'EOF'
config: {}
networks:
- config:
    ipv4.address: 10.99.0.1/24
    ipv4.nat: "true"
    ipv6.address: none
  name: incusbr0
  type: bridge
storage_pools:
- config: {}
  name: default
  driver: dir
profiles:
- name: default
  devices:
    eth0:
      name: eth0
      network: incusbr0
      type: nic
    root:
      path: /
      pool: default
      type: disk
EOF
    incus admin init --preseed </tmp/ha-incus-preseed.yaml
  fi
fi

# Workspace root size is only visible in df on LVM/ZFS, not on dir pools.
if ! incus storage list -c n --format csv 2>/dev/null | grep -qx 'ha-disk'; then
  if command -v lvm >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y lvm2 thin-provisioning-tools >/dev/null 2>&1; then
    incus storage create ha-disk lvm size="${HA_INCUS_POOL_SIZE:-20GiB}" || true
  fi
fi

INCUS_ALIAS="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"

import_incus_image() {
  if incus image list -c l --format csv 2>/dev/null | grep -qx "${INCUS_ALIAS}"; then
    echo "incus alias ${INCUS_ALIAS} already present"
    return 0
  fi
  # If fingerprint already imported (no alias), just alias it.
  ensure_alias() {
    local fp
    fp="$(incus image list --format json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["fingerprint"] if d else "")')"
    if [[ -n "${fp}" ]]; then
      incus image alias create "${INCUS_ALIAS}" "${fp}" 2>/dev/null || true
      if incus image list -c l --format csv 2>/dev/null | grep -qx "${INCUS_ALIAS}"; then
        echo "aliased existing image → ${INCUS_ALIAS}"
        return 0
      fi
    fi
    return 1
  }
  # Prefer split Incus export (metadata + .root)
  if [[ -f "${BUNDLE_DIR}/images/ha-ubuntu-24.04" && -f "${BUNDLE_DIR}/images/ha-ubuntu-24.04.root" ]]; then
    echo "==> incus image import ha-ubuntu-24.04 + .root"
    if ! incus image import "${BUNDLE_DIR}/images/ha-ubuntu-24.04" "${BUNDLE_DIR}/images/ha-ubuntu-24.04.root" --alias "${INCUS_ALIAS}"; then
      ensure_alias || return 1
    fi
    return 0
  fi
  local exp
  exp="$(ls -1 "${BUNDLE_DIR}"/images/ha-ubuntu-24.04.tar.* 2>/dev/null | head -1 || true)"
  if [[ -n "${exp}" ]]; then
    echo "==> incus image import ${exp}"
    if ! incus image import "${exp}" --alias "${INCUS_ALIAS}"; then
      ensure_alias || return 1
    fi
    return 0
  fi
  local rootfs
  rootfs="$(ls -1 "${BUNDLE_DIR}"/images/ubuntu-*-root.tar.xz 2>/dev/null | head -1 || true)"
  if [[ -n "${rootfs}" ]]; then
    echo "==> import cloud rootfs ${rootfs}"
    local tmp
    tmp="$(mktemp -d)"
    cat >"${tmp}/metadata.yaml" <<EOF
architecture: ${machine}
creation_date: $(date +%s)
properties:
  description: ha-cluster ubuntu cloud rootfs
  os: ubuntu
  release: "24.04"
EOF
    tar -C "${tmp}" -cf "${tmp}/meta.tar" metadata.yaml
    incus image import "${tmp}/meta.tar" "${rootfs}" --alias "${INCUS_ALIAS}"
    rm -rf "${tmp}"
    return 0
  fi
  local dtar="${BUNDLE_DIR}/images/ubuntu-24.04.docker.tar"
  if [[ -f "${dtar}" ]]; then
    if ! command -v docker >/dev/null 2>&1; then
      echo "docker required to convert docker.tar, or ship Incus export / cloud rootfs" >&2
      return 1
    fi
    echo "==> docker load + export → Incus"
    docker load -i "${dtar}"
    local img_id="ubuntu:24.04"
    local cid
    cid="$(docker create "${img_id}" /bin/true)"
    local tmp
    tmp="$(mktemp -d)"
    docker export "${cid}" -o "${tmp}/rootfs.tar"
    docker rm "${cid}" >/dev/null
    cat >"${tmp}/metadata.yaml" <<EOF
architecture: ${machine}
creation_date: $(date +%s)
properties:
  description: ha-cluster from docker save ubuntu:24.04
  os: ubuntu
  release: "24.04"
EOF
    tar -C "${tmp}" -cf "${tmp}/meta.tar" metadata.yaml
    incus image import "${tmp}/meta.tar" "${tmp}/rootfs.tar" --alias "${INCUS_ALIAS}"
    rm -rf "${tmp}"
    return 0
  fi
  echo "ERROR: no workspace image in bundle" >&2
  return 1
}

import_incus_image

ha-setup join --token "${TOKEN}" --root "${ROOT_DIR}" --role "${ROLE}" \
  --power "${POWER}" --class "${CLASS}" --fabric-ip "${FABRIC_IP}"

if [[ -n "${API_OVERRIDE}" ]]; then
  sed -i "s|^HA_API=.*|HA_API=${API_OVERRIDE}|" "${ROOT_DIR}/join.env"
fi
grep -q '^HA_NODE_NAME=' "${ROOT_DIR}/join.env" || echo "HA_NODE_NAME=${NODE_NAME}" >>"${ROOT_DIR}/join.env"
grep -q '^HA_INCUS_IMAGE=' "${ROOT_DIR}/join.env" || echo "HA_INCUS_IMAGE=${INCUS_ALIAS}" >>"${ROOT_DIR}/join.env"

if [[ "${SKIP_K3S}" != "1" ]]; then
  K3S_URL="$(grep '^HA_K3S=' "${ROOT_DIR}/join.env" | cut -d= -f2- || true)"
  K3S_BIN=""
  [[ -x "${BUNDLE_DIR}/k3s/k3s" ]] && K3S_BIN="${BUNDLE_DIR}/k3s/k3s"
  if [[ -z "${K3S_URL}" ]]; then
    echo "warn: HA_K3S empty — skip k3s agent"
  elif [[ -z "${K3S_BIN}" ]]; then
    echo "warn: k3s binary missing in bundle — skip"
  elif [[ -z "${K3S_TOKEN:-}" ]]; then
    echo "warn: K3S_TOKEN unset — skip k3s agent"
  else
    install -m 0755 "${K3S_BIN}" /usr/local/bin/k3s
    mkdir -p /var/lib/rancher/k3s/agent/images
    compgen -G "${BUNDLE_DIR}/k3s/k3s-airgap-images-*.tar*" >/dev/null && \
      cp -n "${BUNDLE_DIR}"/k3s/k3s-airgap-images-*.tar* /var/lib/rancher/k3s/agent/images/ || true
    cat >/etc/systemd/system/k3s-agent.service <<EOF
[Unit]
Description=k3s agent (ha-cluster worker-bundle)
After=network-online.target
Wants=network-online.target

[Service]
Environment=K3S_URL=${K3S_URL}
Environment=K3S_TOKEN=${K3S_TOKEN}
ExecStart=/usr/local/bin/k3s agent --node-ip=${FABRIC_IP} --node-label=kubernetes.io/arch=${machine} --node-label=ha-cluster.mnnumath.vip/power=${POWER} --node-label=ha-cluster.mnnumath.vip/class=${CLASS}
Restart=always

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now k3s-agent
  fi
fi

UNIT_SRC="${BUNDLE_DIR}/deploy/ha-agent.service"
[[ -f "${ROOT_DIR}/ha-agent.service" ]] && UNIT_SRC="${ROOT_DIR}/ha-agent.service"
install -m 0644 "${UNIT_SRC}" /etc/systemd/system/ha-agent.service
mkdir -p /etc/systemd/system/ha-agent.service.d
cat >/etc/systemd/system/ha-agent.service.d/override.conf <<EOF
[Service]
EnvironmentFile=-${ROOT_DIR}/join.env
Environment=HA_NODE_NAME=${NODE_NAME}
Environment=HA_INCUS_IMAGE=${INCUS_ALIAS}
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

echo
echo "OK worker=${NODE_NAME} arch=${machine} fabric=${FABRIC_IP} power=${POWER} class=${CLASS}"
echo "incus alias=${INCUS_ALIAS}"
echo "check: incus image list ; systemctl status ha-agent ; journalctl -u ha-agent -n 30"
