#!/usr/bin/env bash
# PVE 测试 Worker 一键安装（Depot 离线）
#   curl -fsSL https://rustfs.s.ggss.club:50000/typora/ha-cluster/lab/install.sh | bash
set -euo pipefail

: "${NODE_NAME:?NODE_NAME required}"
: "${FABRIC_IP:?FABRIC_IP required}"

DEPOT_PUBLIC="${DEPOT_PUBLIC:-https://rustfs.s.ggss.club:50000/typora/ha-cluster}"
STAGING="${STAGING:-${DEPOT_PUBLIC}}"
LAB_BASE="${STAGING%/}/lab"

INSTALL_ROOT="/tmp/ha-pve-lab-install"
mkdir -p "${INSTALL_ROOT}"

_user_skip_incus="${SKIP_INCUS:-}"
_user_skip_et="${SKIP_EASYTIER:-}"
_user_api_base="${HA_API_BASE:-}"
_user_et_secret="${HA_ET_SECRET:-}"
_user_et_peers="${HA_ET_PEERS:-}"
curl --connect-timeout 5 --max-time 30 -fsSL "${LAB_BASE}/lab.defaults.env" -o "${INSTALL_ROOT}/lab.defaults.env"
# shellcheck disable=SC1091
source "${INSTALL_ROOT}/lab.defaults.env"
for _v in HA_INSTALL_MODE HA_APT_MIRROR SKIP_INCUS SKIP_EASYTIER; do
  # shellcheck disable=SC2086
  eval "${_v}=\"\${${_v}//\$'\\r'/}\""
done
if [[ -n "${_user_skip_incus}" ]]; then SKIP_INCUS="${_user_skip_incus}"; fi
if [[ -n "${_user_skip_et}" ]]; then SKIP_EASYTIER="${_user_skip_et}"; fi
if [[ -n "${_user_api_base}" ]]; then HA_API_BASE="${_user_api_base}"; fi
if [[ -n "${_user_et_secret}" ]]; then HA_ET_SECRET="${_user_et_secret}"; fi
if [[ -n "${_user_et_peers}" ]]; then HA_ET_PEERS="${_user_et_peers}"; fi

curl --connect-timeout 5 --max-time 30 -fsSL "${LAB_BASE}/worker-install.sh" -o "${INSTALL_ROOT}/worker-install.sh"
chmod 0755 "${INSTALL_ROOT}/worker-install.sh"
export STAGING="${STAGING}"
export DEPOT_PUBLIC="${DEPOT_PUBLIC}"
exec bash "${INSTALL_ROOT}/worker-install.sh"
