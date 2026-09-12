#!/usr/bin/env bash
# Worker / office host already on EasyTier: only resolve cl.qzsyzn.com
# via fabric DNS so browsers keep using the real domain but traffic
# stays on 10.129.129.0/24.
set -eu
FABRIC_DNS="${HA_FABRIC_DNS:-10.129.129.253}"
DOMAIN="${HA_FABRIC_DNS_DOMAIN:-cl.qzsyzn.com}"
mkdir -p /etc/systemd/resolved.conf.d
cat >/etc/systemd/resolved.conf.d/ha-fabric.conf <<EOF
[Resolve]
DNS=${FABRIC_DNS}
Domains=~${DOMAIN}
EOF
systemctl restart systemd-resolved 2>/dev/null || true
echo "fabric DNS ${FABRIC_DNS} for ~${DOMAIN}"
