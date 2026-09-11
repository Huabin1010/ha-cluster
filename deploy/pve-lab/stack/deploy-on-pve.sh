#!/usr/bin/env bash
# 在 PVE 宿主机执行：把 stack 装进 VM 113 并启 EasyTier Hub
set -euo pipefail

VMID="${VMID:-113}"
LAN_IP="${LAN_IP:?LAN_IP required}"
TAR="${TAR:-/tmp/ha-cluster-stack.tar.gz}"
PVE_IP="${PVE_IP:-192.168.1.8}"

python3 -m http.server 18888 --directory "$(dirname "$TAR")" &
HPID=$!
sleep 1

qm guest exec "$VMID" --timeout 900 -- bash -lc "
set -euo pipefail
mkdir -p /opt/ha-cluster-stack
curl -fsSL http://${PVE_IP}:18888/$(basename "$TAR") -o /opt/ha-cluster-stack/ha-cluster-stack.tar.gz
cd /opt/ha-cluster-stack
tar xzf ha-cluster-stack.tar.gz
cd ha-cluster-stack
cp -n env.example stack.env
sed -i 's|192.168.1.66|${LAN_IP}|g; s|192.168.1.8|${LAN_IP}|g' stack.env
echo HUB_LAN_IP=${LAN_IP} >> stack.env
bash install-stack.sh
"

kill "$HPID" 2>/dev/null || true

qm guest exec "$VMID" --timeout 300 -- bash -lc "
set -euo pipefail
cd /opt/ha-cluster-stack/ha-cluster-stack
bash install-hub.sh
"

echo "==> deployed API http://${LAN_IP}:8080 hub ${LAN_IP}:15010"
