#!/usr/bin/env bash
# 在带 Docker 的 Linux 上安装 ha-cluster 控制面（API + Postgres）
set -euo pipefail

STACK_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${STACK_DIR}"

ENV_FILE="${STACK_DIR}/stack.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  cp env.example stack.env
  ENV_FILE=stack.env
fi

if [[ -f ha-api-image.tar.gz ]]; then
  echo "==> loading ha-api image"
  docker load < ha-api-image.tar.gz
fi
if [[ -f postgres-image.tar.gz ]]; then
  echo "==> loading postgres image"
  docker load < postgres-image.tar.gz
fi

echo "==> starting stack (recreate api so a rebuilt image actually runs)"
docker compose --env-file "${ENV_FILE}" up -d --force-recreate --no-deps api
docker compose --env-file "${ENV_FILE}" up -d

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT:-8080}/healthz" >/dev/null 2>&1; then
    echo "==> API healthy"
    curl -fsS "http://127.0.0.1:${API_PORT:-8080}/healthz"
    exit 0
  fi
  sleep 2
done

echo "error: API not healthy after 60s" >&2
docker compose logs api --tail 40
exit 1
