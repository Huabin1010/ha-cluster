#!/usr/bin/env bash
# 在 PVE 测试 VM 内执行：安装 EasyTier + Incus + ha-agent（Path A 本地联调）
# 由 bootstrap 通过 qm guest exec 调用；也可手动：
#   curl -fsSL http://192.168.1.100:19090/worker-install.sh | sudo bash
set -euo pipefail

: "${STAGING:?STAGING base URL required}"
: "${NODE_NAME:?NODE_NAME required}"
: "${FABRIC_IP:?FABRIC_IP required}"

INSTALL_ROOT="/tmp/ha-pve-lab-install"
mkdir -p "${INSTALL_ROOT}"
if [[ -z "${HA_API_BASE:-}" ]]; then
  for env_name in lab.defaults.env lab.env; do
    if curl --connect-timeout 5 --max-time 15 -fsSL "${STAGING}/${env_name}" -o "${INSTALL_ROOT}/loaded.env" 2>/dev/null; then
      # shellcheck disable=SC1091
      source "${INSTALL_ROOT}/loaded.env"
      break
    fi
  done
fi

HA_API_BASE="${HA_API_BASE:-http://127.0.0.1:8080}"
HA_NODE_TOKEN="${HA_NODE_TOKEN:-ha-test-node-token-2026}"
HA_ET_NET="${HA_ET_NET:-ha-cluster-easytier}"
HA_ET_VERSION="${HA_ET_VERSION:-v2.6.4}"
HA_INCUS_IMAGE="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
SKIP_INCUS="${SKIP_INCUS:-0}"
SKIP_EASYTIER="${SKIP_EASYTIER:-0}"

if [[ "${SKIP_EASYTIER}" != "1" && ( -z "${HA_ET_SECRET:-}" || "${HA_ET_SECRET}" == replace-with-hub-secret ) ]]; then
  echo "error: set HA_ET_SECRET in deploy/pve-lab/lab.env (Hub 网络密钥)" >&2
  exit 1
fi

echo "==> [${NODE_NAME}] install binaries from ${STAGING}"
systemctl stop ha-agent 2>/dev/null || true
curl --connect-timeout 5 --max-time 120 -fsSL "${STAGING}/ha-agent-linux-amd64" -o /tmp/ha-agent.new
install -m 0755 /tmp/ha-agent.new /usr/local/bin/ha-agent
rm -f /tmp/ha-agent.new

if [[ "${SKIP_EASYTIER}" != "1" ]]; then
  if curl -fsSL "${STAGING}/easytier-core" -o /usr/local/bin/easytier-core 2>/dev/null; then
    chmod 0755 /usr/local/bin/easytier-core
  else
    echo "==> download easytier ${HA_ET_VERSION} from GitHub"
    et_zip="easytier-linux-x86_64-${HA_ET_VERSION}.zip"
    curl -fsSL "https://github.com/EasyTier/EasyTier/releases/download/${HA_ET_VERSION}/${et_zip}" -o "${INSTALL_ROOT}/${et_zip}"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unzip ca-certificates curl
    unzip -qo "${INSTALL_ROOT}/${et_zip}" -d "${INSTALL_ROOT}/et"
    install -m 0755 "$(find "${INSTALL_ROOT}/et" -name easytier-core | head -1)" /usr/local/bin/easytier-core
  fi
fi

if [[ "${SKIP_EASYTIER}" != "1" ]]; then
  mkdir -p /etc/ha-cluster /usr/local/libexec/ha-cluster
  curl --connect-timeout 5 --max-time 30 -fsSL "${STAGING}/easytier-start.sh" -o /usr/local/libexec/ha-cluster/easytier-start.sh
  chmod 0755 /usr/local/libexec/ha-cluster/easytier-start.sh
  cat >/etc/ha-cluster/easytier.env <<EOF
HA_ET_NET=${HA_ET_NET}
HA_ET_SECRET=${HA_ET_SECRET}
HA_ET_IPV4=${FABRIC_IP}/24
HA_ET_INSTANCE=et-${NODE_NAME}
HA_ET_DEV=easytier
HA_ET_PEERS=${HA_ET_PEERS}
EOF
  chmod 600 /etc/ha-cluster/easytier.env
  curl -fsSL "${STAGING}/easytier.service" -o /etc/systemd/system/easytier.service
  systemctl daemon-reload
  systemctl enable --now easytier
fi

if [[ "${SKIP_INCUS}" != "1" ]]; then
  if ! command -v incus >/dev/null 2>&1; then
    echo "==> apt install incus"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq incus
  fi
  if ! incus info >/dev/null 2>&1; then
    incus admin init --auto 2>/dev/null || true
  fi
  if ! incus image list -c l --format csv 2>/dev/null | grep -qx "${HA_INCUS_IMAGE}"; then
    echo "==> import ubuntu 24.04 cloud image as ${HA_INCUS_IMAGE}"
    incus launch "images:ubuntu/24.04/cloud" "ha-bootstrap-${NODE_NAME}" --no-console || true
    fp="$(incus list "ha-bootstrap-${NODE_NAME}" --format json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["fingerprint"] if d else "")' 2>/dev/null || true)"
    incus stop "ha-bootstrap-${NODE_NAME}" --force 2>/dev/null || true
    incus delete "ha-bootstrap-${NODE_NAME}" 2>/dev/null || true
    if [[ -n "${fp}" ]]; then
      incus image alias create "${HA_INCUS_IMAGE}" "${fp}" 2>/dev/null || true
    fi
    if ! incus image list -c l --format csv 2>/dev/null | grep -qx "${HA_INCUS_IMAGE}"; then
      incus image copy images:ubuntu/24.04/cloud local: --alias "${HA_INCUS_IMAGE}" || true
    fi
  fi
fi

hostnamectl set-hostname "${NODE_NAME}" 2>/dev/null || hostname "${NODE_NAME}"

cat >/etc/systemd/system/ha-agent.service <<EOF
[Unit]
Description=ha-cluster worker agent (${NODE_NAME})
After=network-online.target easytier.service docker.service
Wants=network-online.target

[Service]
Type=simple
Environment=HA_INCUS_IMAGE=${HA_INCUS_IMAGE}
ExecStart=/usr/local/bin/ha-agent \\
  -api ${HA_API_BASE} \\
  -name ${NODE_NAME} \\
  -fabric-ip ${FABRIC_IP} \\
  -class desktop \\
  -power mains \\
  -cpu-milli 4000 \\
  -mem-bytes 4294967296 \\
  -disk-bytes 34359738368 \\
  -token ${HA_NODE_TOKEN} \\
  -listen :9091 \\
  -interval 15s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ha-agent
systemctl is-active ha-agent

echo "==> heartbeat once"
/usr/local/bin/ha-agent -api "${HA_API_BASE}" -name "${NODE_NAME}" -fabric-ip "${FABRIC_IP}" -token "${HA_NODE_TOKEN}" -once || true

if [[ "${SKIP_EASYTIER}" != "1" ]]; then
  echo "==> ping hub (best effort)"
  ping -c 2 -W 2 10.129.129.1 || echo "warn: overlay ping failed (Hub 未通或 secret 不匹配)"
fi

echo "==> done ${NODE_NAME} fabric=${FABRIC_IP} api=${HA_API_BASE}"
