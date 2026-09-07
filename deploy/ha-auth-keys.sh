#!/bin/bash
# AuthorizedKeysCommand helper for ha-cluster bastion sshd.
# Usage: ha-auth-keys <username>   (OpenSSH passes %u)
set -euo pipefail

USER_NAME="${1:-}"
if [[ -z "$USER_NAME" ]]; then
  exit 0
fi

# Refuse OS accounts that must never be bastion-routed.
case "$USER_NAME" in
  root|nobody|sync|shutdown|halt|systemd-*) exit 0 ;;
esac

ENV_FILE="${HA_BASTION_ENV:-/etc/ha-cluster/bastion.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # Only export safe KEY=VALUE lines (no command substitution).
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done <"$ENV_FILE"
  set +a
fi

API="${HA_API:-http://127.0.0.1:8080}"
TOKEN="${HA_INTERNAL_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  exit 0
fi

# sshd AuthorizedKeysCommandUser is nobody — bastion.env must be root:nogroup mode 640.
url="${API%/}/internal/authorized-keys?user=$(printf '%s' "$USER_NAME" | sed 's/ /%20/g')"
resp="$(curl -fsS --max-time 3 -H "X-HA-Internal: ${TOKEN}" "$url" 2>/dev/null || true)"
if [[ -z "$resp" ]]; then
  exit 0
fi
printf '%s\n' "$resp"
