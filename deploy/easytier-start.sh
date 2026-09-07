#!/bin/bash
# Start easytier-core from /etc/ha-cluster/easytier.env
set -euo pipefail

: "${HA_ET_NET:?HA_ET_NET required}"
: "${HA_ET_SECRET:?HA_ET_SECRET required}"
: "${HA_ET_IPV4:?HA_ET_IPV4 required}"
: "${HA_ET_INSTANCE:?HA_ET_INSTANCE required}"

DEV="${HA_ET_DEV:-easytier}"
BIN="${HA_ET_BIN:-/usr/local/bin/easytier-core}"

args=(
  --network-name "${HA_ET_NET}"
  --network-secret "${HA_ET_SECRET}"
  --ipv4 "${HA_ET_IPV4}"
  --dev-name "${DEV}"
  --instance-name "${HA_ET_INSTANCE}"
)

# shellcheck disable=SC2206
if [[ -n "${HA_ET_LISTENERS:-}" ]]; then
  for l in ${HA_ET_LISTENERS}; do
    [[ -n "$l" ]] || continue
    args+=(--listeners "$l")
  done
else
  args+=(--no-listener)
fi

# shellcheck disable=SC2206
if [[ -n "${HA_ET_PEERS:-}" ]]; then
  for p in ${HA_ET_PEERS}; do
    [[ -n "$p" ]] || continue
    args+=(--peers "$p")
  done
fi

exec "${BIN}" "${args[@]}"
