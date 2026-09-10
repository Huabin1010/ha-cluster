#!/usr/bin/env bash
# PVE 测试 Worker 一键安装入口（从 Depot CDN 拉取）
#   curl -fsSL https://rustfs.s.ggss.club:50000/typora/ha-cluster/pve-lab/install.sh | bash
#
# 必填环境变量：NODE_NAME、FABRIC_IP
# 可选：HA_API_BASE、HA_NODE_TOKEN、SKIP_INCUS、SKIP_EASYTIER、HA_ET_SECRET
set -euo pipefail

: "${NODE_NAME:?NODE_NAME required}"
: "${FABRIC_IP:?FABRIC_IP required}"

if [[ -z "${STAGING:-}" ]]; then
  DEPOT_PUBLIC="${DEPOT_PUBLIC:-https://rustfs.s.ggss.club:50000/typora/ha-cluster}"
  STAGING="${DEPOT_PUBLIC%/}/pve-lab"
fi
LAB_BASE="${STAGING}"

INSTALL_ROOT="/tmp/ha-pve-lab-install"
mkdir -p "${INSTALL_ROOT}"

curl --connect-timeout 5 --max-time 30 -fsSL "${LAB_BASE}/lab.defaults.env" -o "${INSTALL_ROOT}/lab.defaults.env"
# shellcheck disable=SC1091
source "${INSTALL_ROOT}/lab.defaults.env"

curl --connect-timeout 5 --max-time 30 -fsSL "${LAB_BASE}/worker-install.sh" -o "${INSTALL_ROOT}/worker-install.sh"
chmod 0755 "${INSTALL_ROOT}/worker-install.sh"
exec bash "${INSTALL_ROOT}/worker-install.sh"
