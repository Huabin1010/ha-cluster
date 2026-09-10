#!/usr/bin/env bash
# 在 Worker 上安装并启动 EasyTier（需已配置 /etc/ha-cluster/easytier.env）
set -euo pipefail

: "${NODE_NAME:?NODE_NAME required}"
: "${FABRIC_IP:?FABRIC_IP required}"

STAGING="${STAGING:-http://192.168.1.8:19090}"
HA_ET_VERSION="${HA_ET_VERSION:-v2.6.4}"

mkdir -p /etc/ha-cluster /usr/local/libexec/ha-cluster
curl -fsSL "${STAGING}/lab.env" -o /tmp/lab.env
# shellcheck disable=SC1091
source /tmp/lab.env

if [[ -z "${HA_ET_SECRET:-}" || "${HA_ET_SECRET}" == replace-with-hub-secret ]]; then
  echo "error: HA_ET_SECRET not set in lab.env" >&2
  exit 1
fi

if ! command -v easytier-core >/dev/null 2>&1; then
  if curl -fsSL "${STAGING}/easytier-core" -o /usr/local/bin/easytier-core 2>/dev/null; then
    chmod 0755 /usr/local/bin/easytier-core
  else
    et_zip="easytier-linux-x86_64-${HA_ET_VERSION}.zip"
    curl -fsSL "https://github.com/EasyTier/EasyTier/releases/download/${HA_ET_VERSION}/${et_zip}" -o "/tmp/${et_zip}"
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unzip
    unzip -qo "/tmp/${et_zip}" -d /tmp/et
    install -m 0755 "$(find /tmp/et -name easytier-core | head -1)" /usr/local/bin/easytier-core
  fi
fi

curl -fsSL "${STAGING}/easytier-start.sh" -o /usr/local/libexec/ha-cluster/easytier-start.sh
chmod 0755 /usr/local/libexec/ha-cluster/easytier-start.sh
curl -fsSL "${STAGING}/easytier.service" -o /etc/systemd/system/easytier.service

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
systemctl restart ha-agent

ping -c 3 10.129.129.1 || echo "warn: hub ping failed"
systemctl is-active easytier
