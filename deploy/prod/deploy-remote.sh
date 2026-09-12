#!/usr/bin/env bash
# 同步本仓库 deploy/prod 到 42 并 docker compose up
set -euo pipefail

HOST="${HA_PROD_HOST:-root@42.193.236.123}"
REMOTE_DIR="${HA_DEPLOY_DIR:-/www/wwwroot/cl.qzsyzn.com/docker}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_DIR="${ROOT}/deploy/prod"

echo "==> sync to ${HOST}:${REMOTE_DIR}"
ssh "${HOST}" "mkdir -p '${REMOTE_DIR}'"
rsync -az --exclude '.env' --exclude '_bt_print_token.py' \
  "${LOCAL_DIR}/docker-compose.yaml" \
  "${LOCAL_DIR}/.env.example" \
  "${LOCAL_DIR}/baota_api.py" \
  "${LOCAL_DIR}/install-easytier-peer.sh" \
  "${LOCAL_DIR}/prep-host.sh" \
  "${LOCAL_DIR}/README.md" \
  "${HOST}:${REMOTE_DIR}/"

if [[ -f "${LOCAL_DIR}/.env" ]]; then
  scp "${LOCAL_DIR}/.env" "${HOST}:${REMOTE_DIR}/.env"
elif ssh "${HOST}" "test -f '${REMOTE_DIR}/.env'"; then
  echo "==> remote .env exists, keep"
else
  echo "error: 需要先生成 deploy/prod/.env（参考 .env.example）" >&2
  exit 1
fi

ssh "${HOST}" "chmod 600 '${REMOTE_DIR}/.env'; cd '${REMOTE_DIR}' && docker compose pull && docker compose up -d"
ssh "${HOST}" "sleep 5; curl -fsS http://127.0.0.1:18082/healthz || curl -fsS http://127.0.0.1:18082/api/healthz; echo"
echo "==> deploy done"
