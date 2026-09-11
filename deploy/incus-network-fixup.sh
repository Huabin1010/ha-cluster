#!/usr/bin/env bash
# Incus 桥接与 Docker 共存：Docker 默认 FORWARD DROP 会阻断容器出网。
set -euo pipefail

BRIDGE="${HA_INCUS_BRIDGE:-incusbr0}"

if ! command -v iptables >/dev/null 2>&1; then
  echo "warn: iptables not found, skip incus network fixup" >&2
  exit 0
fi

iptables -C FORWARD -i "${BRIDGE}" -j ACCEPT 2>/dev/null \
  || iptables -I FORWARD -i "${BRIDGE}" -j ACCEPT
iptables -C FORWARD -o "${BRIDGE}" -j ACCEPT 2>/dev/null \
  || iptables -I FORWARD -o "${BRIDGE}" -j ACCEPT
