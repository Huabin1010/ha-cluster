#!/usr/bin/env bash
# 离线安装 EasyTier（Depot bin + lab 脚本）
set -euo pipefail

: "${NODE_NAME:?NODE_NAME required}"
: "${FABRIC_IP:?FABRIC_IP required}"

DEPOT_PUBLIC="${DEPOT_PUBLIC:-https://rustfs.s.ggss.club:50000/typora/ha-cluster}"
STAGING="${STAGING:-${DEPOT_PUBLIC}}"
ROOT="/tmp/ha-et-install"
mkdir -p "${ROOT}"

curl -fsSL "${STAGING%/}/lab/depot-paths.sh" -o "${ROOT}/depot-paths.sh"
# shellcheck disable=SC1091
source "${ROOT}/depot-paths.sh"

if [[ -f /tmp/lab.env ]]; then
  # shellcheck disable=SC1091
  source /tmp/lab.env
fi
if [[ -z "${HA_ET_SECRET:-}" || "${HA_ET_SECRET}" == replace-with-hub-secret ]]; then
  echo "error: HA_ET_SECRET not set" >&2
  exit 1
fi

mkdir -p /etc/ha-cluster /usr/local/libexec/ha-cluster
if ! command -v easytier-core >/dev/null 2>&1; then
  curl -fsSL "$(ha_bin_url easytier-core)" -o /usr/local/bin/easytier-core
  chmod 0755 /usr/local/bin/easytier-core
fi

curl -fsSL "$(ha_lab_url easytier-start.sh)" -o /usr/local/libexec/ha-cluster/easytier-start.sh
chmod 0755 /usr/local/libexec/ha-cluster/easytier-start.sh
curl -fsSL "$(ha_lab_url easytier.service)" -o /etc/systemd/system/easytier.service

cat >/etc/ha-cluster/easytier.env <<EOF
HA_ET_NET=${HA_ET_NET}
HA_ET_SECRET=${HA_ET_SECRET}
HA_ET_IPV4=${FABRIC_IP}/24
HA_ET_INSTANCE=et-${NODE_NAME}
HA_ET_DEV=easytier
HA_ET_PEERS=${HA_ET_PEERS}
EOF
chmod 600 /etc/ha-cluster/easytier.env

systemctl daemon-reload
systemctl enable --now easytier
systemctl restart ha-agent 2>/dev/null || true

ping -c 3 10.129.129.1 || echo "warn: hub ping failed"
systemctl is-active easytier
