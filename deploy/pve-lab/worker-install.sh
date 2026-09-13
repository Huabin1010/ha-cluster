#!/usr/bin/env bash
# Worker 安装：EasyTier + Incus（在线/离线 auto）+ 离线 k3s + ha-agent
# PVE 实验室：NODE_NAME / FABRIC_IP / STAGING / HA_ET_SECRET
# 生产 join：先 ha-setup join 写 /var/lib/ha-setup/join.env，再 curl 本脚本
set -euo pipefail

SETUP_DIR="${HA_SETUP_DIR:-/var/lib/ha-setup}"
JOIN_ENV="${SETUP_DIR}/join.env"
INSTALL_ROOT="${HA_INSTALL_ROOT:-/tmp/ha-pve-lab-install}"
mkdir -p "${INSTALL_ROOT}"

ha_sanitize_env() {
  # set -u 下未定义变量不可展开；先给默认再剥 Windows CR
  HA_INSTALL_MODE="${HA_INSTALL_MODE:-auto}"
  HA_APT_MIRROR="${HA_APT_MIRROR:-}"
  SKIP_INCUS="${SKIP_INCUS:-0}"
  SKIP_EASYTIER="${SKIP_EASYTIER:-0}"
  SKIP_K3S="${SKIP_K3S:-0}"
  HA_UPGRADE="${HA_UPGRADE:-0}"
  HA_VERIFY_EGRESS="${HA_VERIFY_EGRESS:-}"
  HA_INSTALL_MODE="${HA_INSTALL_MODE//$'\r'/}"
  HA_APT_MIRROR="${HA_APT_MIRROR//$'\r'/}"
  SKIP_INCUS="${SKIP_INCUS//$'\r'/}"
  SKIP_EASYTIER="${SKIP_EASYTIER//$'\r'/}"
  SKIP_K3S="${SKIP_K3S//$'\r'/}"
  HA_UPGRADE="${HA_UPGRADE//$'\r'/}"
  HA_VERIFY_EGRESS="${HA_VERIFY_EGRESS//$'\r'/}"
}

# 命令行/实验室显式传入的 Fabric 参数，优先于 join.env（否则会把 worker 指到生产 Hub）
_pin_et_peers="${HA_ET_PEERS:-}"
_pin_et_secret="${HA_ET_SECRET:-}"
_pin_et_net="${HA_ET_NET:-}"
_pin_api_base="${HA_API_BASE:-}"
_pin_skip_incus="${SKIP_INCUS:-}"
_pin_skip_et="${SKIP_EASYTIER:-}"
_pin_skip_k3s="${SKIP_K3S:-}"
_pin_staging="${STAGING:-}"
_pin_depot="${DEPOT_PUBLIC:-${HA_DEPOT_PUBLIC:-}}"

if [[ -f "${JOIN_ENV}" ]]; then
  # shellcheck disable=SC1091
  source "${JOIN_ENV}"
  ha_sanitize_env
fi
if [[ -n "${_pin_et_peers}" ]]; then HA_ET_PEERS="${_pin_et_peers}"; fi
if [[ -n "${_pin_et_secret}" ]]; then HA_ET_SECRET="${_pin_et_secret}"; fi
if [[ -n "${_pin_et_net}" ]]; then HA_ET_NET="${_pin_et_net}"; fi
if [[ -n "${_pin_api_base}" ]]; then HA_API_BASE="${_pin_api_base}"; fi
if [[ -n "${_pin_skip_incus}" ]]; then SKIP_INCUS="${_pin_skip_incus}"; fi
if [[ -n "${_pin_skip_et}" ]]; then SKIP_EASYTIER="${_pin_skip_et}"; fi
if [[ -n "${_pin_skip_k3s}" ]]; then SKIP_K3S="${_pin_skip_k3s}"; fi
if [[ -n "${_pin_staging}" ]]; then STAGING="${_pin_staging}"; fi
if [[ -n "${_pin_depot}" ]]; then DEPOT_PUBLIC="${_pin_depot}"; HA_DEPOT_PUBLIC="${_pin_depot}"; fi

STAGING="${STAGING:-${HA_DEPOT_PUBLIC:-${DEPOT_PUBLIC:-}}}"
NODE_NAME="${NODE_NAME:-${HA_NODE_NAME:-$(hostname)}}"
FABRIC_IP="${FABRIC_IP:-${HA_FABRIC_IP:-}}"
HA_API_BASE="${HA_API_BASE:-${HA_API:-http://127.0.0.1:8080}}"
HA_NODE_TOKEN="${HA_NODE_TOKEN:-}"
HA_POWER="${HA_POWER:-mains}"
HA_CLASS="${HA_CLASS:-desktop}"
HA_INCUS_IMAGE="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
SKIP_INCUS="${SKIP_INCUS:-0}"
SKIP_EASYTIER="${SKIP_EASYTIER:-0}"
SKIP_K3S="${SKIP_K3S:-0}"
HA_UPGRADE="${HA_UPGRADE:-0}"
HA_INSTALL_MODE="${HA_INSTALL_MODE:-auto}"

# 已纳管主机一键升级：未显式指定 SKIP_* 时，跳过已在跑的 Incus / EasyTier，只补 k3s
if [[ "${HA_UPGRADE}" == "1" ]]; then
  if [[ -z "${_pin_skip_incus}" ]] && { command -v incus >/dev/null 2>&1 || systemctl is-active --quiet incus 2>/dev/null; }; then
    SKIP_INCUS=1
    echo "==> upgrade: skip Incus (already present)"
  fi
  if [[ -z "${_pin_skip_et}" ]] && systemctl is-active --quiet easytier 2>/dev/null; then
    SKIP_EASYTIER=1
    echo "==> upgrade: skip EasyTier (already active)"
  fi
fi

[[ -n "${STAGING}" ]] || { echo "error: STAGING or HA_DEPOT_PUBLIC required" >&2; exit 1; }
[[ -n "${FABRIC_IP}" ]] || { echo "error: FABRIC_IP or HA_FABRIC_IP required" >&2; exit 1; }

curl --connect-timeout 5 --max-time 15 -fsSL "${STAGING%/}/lab/depot-paths.sh" -o "${INSTALL_ROOT}/depot-paths.sh"
curl --connect-timeout 5 --max-time 15 -fsSL "${STAGING%/}/lab/os-detect.sh" -o "${INSTALL_ROOT}/os-detect.sh"
# shellcheck disable=SC1091
source "${INSTALL_ROOT}/depot-paths.sh"
source "${INSTALL_ROOT}/os-detect.sh"
export DEPOT_PUBLIC="${DEPOT_PUBLIC:-${STAGING}}"
export HA_INSTALL_MODE

if [[ -z "${HA_API_BASE}" || "${HA_API_BASE}" == "http://127.0.0.1:8080" ]]; then
  if curl --connect-timeout 5 --max-time 15 -fsSL "$(ha_lab_url lab.defaults.env)" -o "${INSTALL_ROOT}/loaded.env" 2>/dev/null; then
    # shellcheck disable=SC1091
    source "${INSTALL_ROOT}/loaded.env"
    HA_API_BASE="${HA_API_BASE:-${HA_API:-http://127.0.0.1:8080}}"
    ha_sanitize_env
  fi
fi

ha_sanitize_env
ha_os_detect
curl --connect-timeout 5 --max-time 30 -fsSL "$(ha_lab_url ubuntu-apt-mirror.sh)" -o "${INSTALL_ROOT}/ubuntu-apt-mirror.sh"
# shellcheck disable=SC1091
source "${INSTALL_ROOT}/ubuntu-apt-mirror.sh"
ha_apt_mirror_apply "${HA_OS_CODENAME}" "${HA_OS_DEB_ARCH}" || true
echo "==> [${NODE_NAME}] install from $(ha_depot_base) ($(ha_os_suite_label), incus=${HA_INSTALL_MODE:-auto}, k3s=$([ "${SKIP_K3S}" = "1" ] && echo skip || echo offline), apt=${HA_APT_MIRROR:-default})"

if [[ "${SKIP_EASYTIER}" != "1" && -z "${HA_ET_SECRET:-}" && ! -f "${SETUP_DIR}/easytier.service" ]]; then
  echo "error: set HA_ET_SECRET (lab) or run ha-setup join first (production)" >&2
  exit 1
fi

systemctl stop ha-agent 2>/dev/null || true
curl --connect-timeout 5 --max-time 120 -fsSL "$(ha_bin_url ha-agent)" -o /tmp/ha-agent.new
install -m 0755 /tmp/ha-agent.new /usr/local/bin/ha-agent
rm -f /tmp/ha-agent.new

if [[ "${SKIP_EASYTIER}" != "1" ]]; then
  curl --connect-timeout 5 --max-time 120 -fsSL "$(ha_bin_url easytier-core)" -o /tmp/easytier-core.new
  install -m 0755 /tmp/easytier-core.new /usr/local/bin/easytier-core
  rm -f /tmp/easytier-core.new

  if [[ -f "${SETUP_DIR}/easytier.service" ]]; then
    echo "==> easytier from join.env (${SETUP_DIR})"
    install -m 0644 "${SETUP_DIR}/easytier.service" /etc/systemd/system/easytier.service
    systemctl daemon-reload
    systemctl enable --now easytier
  else
    mkdir -p /etc/ha-cluster /usr/local/libexec/ha-cluster
    curl --connect-timeout 5 --max-time 30 -fsSL "$(ha_lab_url easytier-start.sh)" -o /usr/local/libexec/ha-cluster/easytier-start.sh
    chmod 0755 /usr/local/libexec/ha-cluster/easytier-start.sh
    cat >/etc/ha-cluster/easytier.env <<EOF
HA_ET_NET=${HA_ET_NET:-ha-cluster-easytier}
HA_ET_SECRET=${HA_ET_SECRET}
HA_ET_IPV4=${FABRIC_IP}/24
HA_ET_INSTANCE=et-${NODE_NAME}
HA_ET_DEV=easytier
HA_ET_PEERS=${HA_ET_PEERS:-${HA_ET_PEER:-}}
EOF
    chmod 600 /etc/ha-cluster/easytier.env
    curl -fsSL "$(ha_lab_url easytier.service)" -o /etc/systemd/system/easytier.service
    systemctl daemon-reload
    systemctl enable --now easytier
  fi
fi

if [[ "${SKIP_INCUS}" != "1" ]]; then
  curl --connect-timeout 10 --max-time 60 -fsSL "$(ha_lab_url install-incus.sh)" -o "${INSTALL_ROOT}/install-incus.sh"
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/install-incus.sh"
  ha_incus_install_worker "${INSTALL_ROOT}/incus-bundle"
  # 工作区 Launch 会把该插件推进容器；缺了会 500
  mkdir -p /var/lib/ha-cluster
  if [[ ! -s /var/lib/ha-cluster/docker-compose ]]; then
    echo "==> docker compose plugin from Depot"
    curl --connect-timeout 10 --max-time 180 -fsSL "$(ha_bin_url docker-compose)" -o /tmp/docker-compose.new
    install -m 0755 /tmp/docker-compose.new /var/lib/ha-cluster/docker-compose
    rm -f /tmp/docker-compose.new
  fi
fi

if [[ "${SKIP_K3S}" != "1" ]]; then
  curl --connect-timeout 10 --max-time 60 -fsSL "$(ha_lab_url install-k3s.sh)" -o "${INSTALL_ROOT}/install-k3s.sh"
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/install-k3s.sh"
  ha_k3s_install_worker
fi

hostnamectl set-hostname "${NODE_NAME}" 2>/dev/null || hostname "${NODE_NAME}"

HA_NODE_TAGS="${HA_NODE_TAGS:-}"
if [[ -f "${SETUP_DIR}/k3s.ready" ]]; then
  HA_NODE_TAGS="${HA_NODE_TAGS:-k3s,both}"
fi

if [[ -f "${SETUP_DIR}/ha-agent.service" ]]; then
  install -m 0644 "${SETUP_DIR}/ha-agent.service" /etc/systemd/system/ha-agent.service
else
  cat >/etc/systemd/system/ha-agent.service <<EOF
[Unit]
Description=ha-cluster worker agent (${NODE_NAME})
After=network-online.target easytier.service docker.service
Wants=network-online.target

[Service]
Type=simple
Environment=HA_INCUS_IMAGE=${HA_INCUS_IMAGE}
Environment=HA_NODE_TAGS=${HA_NODE_TAGS}
ExecStart=/usr/local/bin/ha-agent \\
  -api ${HA_API_BASE} \\
  -name ${NODE_NAME} \\
  -fabric-ip ${FABRIC_IP} \\
  -class ${HA_CLASS} \\
  -power ${HA_POWER} \\
  -cpu-milli 4000 \\
  -mem-bytes 4294967296 \\
  -disk-bytes 34359738368 \\
  -token ${HA_NODE_TOKEN} \\
  -tags ${HA_NODE_TAGS} \\
  -listen :9091 \\
  -interval 15s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable --now ha-agent
systemctl is-active ha-agent

echo "==> verify installation"
curl --connect-timeout 5 --max-time 30 -fsSL "$(ha_lab_url verify-worker.sh)" -o "${INSTALL_ROOT}/verify-worker.sh"
chmod 0755 "${INSTALL_ROOT}/verify-worker.sh"
export SKIP_EASYTIER="${SKIP_EASYTIER:-0}"
export SKIP_K3S="${SKIP_K3S:-0}"
export HA_VERIFY_EGRESS="${HA_VERIFY_EGRESS:-0}"
bash "${INSTALL_ROOT}/verify-worker.sh"

echo "==> heartbeat once"
/usr/local/bin/ha-agent -api "${HA_API_BASE}" -name "${NODE_NAME}" -fabric-ip "${FABRIC_IP}" -token "${HA_NODE_TOKEN}" -tags "${HA_NODE_TAGS}" -once || true

if [[ "${SKIP_EASYTIER}" != "1" ]]; then
  echo "==> ping hub (best effort)"
  ping -c 2 -W 2 10.129.129.1 || echo "warn: overlay ping failed"
fi

echo "==> done ${NODE_NAME} fabric=${FABRIC_IP} api=${HA_API_BASE}"
