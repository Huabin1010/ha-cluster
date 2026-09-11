#!/usr/bin/env bash
# 在 PVE 宿主机或任意 Linux 上安装 ha-cluster EasyTier Hub（独立实例，不碰现有 txcloud easytier）
set -euo pipefail

STACK_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${STACK_DIR}/stack.env"
[[ -f "${ENV_FILE}" ]] || ENV_FILE="${STACK_DIR}/env.example"
# 只取 hub 相关变量，避免 HA_ET_PEERS 等带空格项被 shell 拆开
while IFS= read -r line; do
  [[ "$line" =~ ^(HA_ET_|HUB_) ]] || continue
  [[ "$line" =~ ^# ]] && continue
  export "$line"
done < "${ENV_FILE}"

HA_ET_NET="${HA_ET_NET:-ha-cluster-easytier}"
HA_ET_IPV4="${HA_ET_IPV4:-10.129.129.1/24}"
HA_ET_LISTEN_PORT="${HA_ET_LISTEN_PORT:-15010}"
HA_ET_INSTANCE="${HA_ET_INSTANCE:-et-ha-cluster-hub}"
HA_ET_DEV="${HA_ET_DEV:-easytier-ha}"
ET_BIN="${ET_BIN:-/usr/local/bin/easytier-core}"

if [[ -z "${HA_ET_SECRET:-}" || "${HA_ET_SECRET}" == generate-on-install ]]; then
  if [[ -f /etc/ha-cluster/easytier-ha.env ]]; then
    # shellcheck disable=SC1091
    source /etc/ha-cluster/easytier-ha.env
  else
    HA_ET_SECRET="$(openssl rand -hex 16)"
  fi
fi

mkdir -p /etc/ha-cluster /usr/local/libexec/ha-cluster
if [[ -f "${STACK_DIR}/easytier-core" ]]; then
  install -m 0755 "${STACK_DIR}/easytier-core" "${ET_BIN}"
elif [[ ! -x "${ET_BIN}" ]]; then
  echo "error: easytier-core not found; pack stack with dist/pve-lab/easytier-core" >&2
  exit 1
fi

install -m 0755 "${STACK_DIR}/easytier-start.sh" /usr/local/libexec/ha-cluster/easytier-start.sh

cat >/etc/ha-cluster/easytier-ha.env <<EOF
HA_ET_ROLE=hub
HA_ET_NET=${HA_ET_NET}
HA_ET_SECRET=${HA_ET_SECRET}
HA_ET_IPV4=${HA_ET_IPV4}
HA_ET_INSTANCE=${HA_ET_INSTANCE}
HA_ET_DEV=${HA_ET_DEV}
HA_ET_LISTENERS="udp://0.0.0.0:${HA_ET_LISTEN_PORT} tcp://0.0.0.0:${HA_ET_LISTEN_PORT}"
EOF
chmod 600 /etc/ha-cluster/easytier-ha.env

cat >/etc/systemd/system/easytier-ha-cluster.service <<'UNIT'
[Unit]
Description=ha-cluster EasyTier Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/ha-cluster/easytier-ha.env
ExecStart=/usr/local/libexec/ha-cluster/easytier-start.sh
Restart=always
RestartSec=3
LimitNOFILE=1048576
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now easytier-ha-cluster
sleep 2
systemctl is-active easytier-ha-cluster
echo "==> Hub ${HA_ET_IPV4} listeners :${HA_ET_LISTEN_PORT}"
echo "==> HA_ET_SECRET=${HA_ET_SECRET}"
echo "==> peers: udp://${HUB_LAN_IP:-$(hostname -I | awk '{print $1}')}:${HA_ET_LISTEN_PORT}"
