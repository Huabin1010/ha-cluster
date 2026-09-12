#!/usr/bin/env bash
# 在 42 上以 peer 身份加入 EasyTier Hub（非 Hub）
# 虚 IP 固定 10.129.129.253
set -euo pipefail

ET_NET="${HA_ET_NET:-ha-cluster-easytier}"
ET_SECRET="${HA_ET_SECRET:?HA_ET_SECRET required}"
ET_IPV4="${HA_ET_IPV4:-10.129.129.253}"
ET_PEER="${HA_ET_PEER:-tcp://110.40.229.62:15010}"
ET_PEER_UDP="${HA_ET_PEER_UDP:-udp://110.40.229.62:15010}"
INSTANCE="${HA_ET_INSTANCE:-et-cl-qzsyzn}"
BIN="${HA_ET_BIN:-/usr/local/bin/easytier-core}"
UNIT_DIR="${HA_ET_UNIT_DIR:-/etc/systemd/system}"
ENV_FILE="${HA_ET_ENV_FILE:-/etc/ha-cluster/easytier.env}"

if [[ ! -x "${BIN}" ]]; then
  echo "error: ${BIN} missing; install easytier-core first" >&2
  exit 1
fi

mkdir -p /etc/ha-cluster
umask 077
cat >"${ENV_FILE}" <<EOF
HA_ET_NET=${ET_NET}
HA_ET_SECRET=${ET_SECRET}
HA_ET_IPV4=${ET_IPV4}
HA_ET_PEER=${ET_PEER}
HA_ET_PEER_UDP=${ET_PEER_UDP}
HA_ET_INSTANCE=${INSTANCE}
EOF
chmod 600 "${ENV_FILE}"

cat >"${UNIT_DIR}/ha-easytier.service" <<EOF
[Unit]
Description=ha-cluster EasyTier peer (control/edge)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
ExecStart=${BIN} \\
  --ipv4 \${HA_ET_IPV4} \\
  --network-name \${HA_ET_NET} \\
  --network-secret \${HA_ET_SECRET} \\
  --peers \${HA_ET_PEER} \\
  --peers \${HA_ET_PEER_UDP} \\
  --instance-name \${HA_ET_INSTANCE} \\
  --no-listener \\
  --dev-name easytier
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ha-easytier.service
sleep 2
systemctl --no-pager --full status ha-easytier.service || true
echo "==> ping Hub 10.129.129.1"
ping -c 3 -W 3 10.129.129.1 || true
