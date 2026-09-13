#!/usr/bin/env bash
# 滚动更新 ha-api-a / ha-api-b，不重启 postgres / edge / fabric-dns。
# 一侧失败则停住，不拆另一侧。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${DIR}"

PUBLIC_HEALTH="${HA_PUBLIC_HEALTH:-https://cl.qzsyzn.com/healthz}"
SLOT_A_URL="http://127.0.0.1:${HA_HOST_PORT:-18082}/healthz"
SLOT_B_URL="http://127.0.0.1:${HA_HOST_PORT_B:-18084}/healthz"
EDGE_URL="http://127.0.0.1:${HA_EDGE_PORT:-18080}/healthz"
DRY_RUN="${1:-}"

log() { echo "==> $*"; }

wait_http() {
  local url="$1" name="$2" tries="${3:-36}"
  local i
  for i in $(seq 1 "${tries}"); do
    if curl -fsS -o /dev/null --connect-timeout 2 --max-time 3 "${url}"; then
      log "${name} healthy (${url})"
      return 0
    fi
    sleep 2
  done
  echo "error: ${name} not healthy: ${url}" >&2
  return 1
}

pg_started_at() {
  docker inspect -f '{{.State.StartedAt}}' ha-postgres 2>/dev/null || true
}

if [[ "${DRY_RUN}" == "--dry-run" ]]; then
  python3 "${DIR}/rolling_check.py" --dry-run
  exit $?
fi

if [[ ! -f .env ]]; then
  echo "error: missing ${DIR}/.env" >&2
  exit 1
fi

chmod 600 .env || true
PG_BEFORE="$(pg_started_at)"

# 从单实例 ha-api 迁到双活时卸掉旧容器，避免占 18082
if docker ps -a --format '{{.Names}}' | grep -qx ha-api; then
  log "removing legacy container ha-api"
  docker rm -f ha-api
fi

log "ensure postgres (no recreate if running)"
docker compose up -d --no-recreate postgres

roll_slot() {
  local svc="$1" url="$2"
  log "recreate ${svc} (no-deps)"
  docker compose up -d --no-deps --force-recreate "${svc}"
  wait_http "${url}" "${svc}"
}

roll_slot ha-api-a "${SLOT_A_URL}"
wait_http "${EDGE_URL}" "edge" 20 || wait_http "${PUBLIC_HEALTH}" "public" 20 || true
roll_slot ha-api-b "${SLOT_B_URL}"

log "reload edge nginx"
if ! docker exec ha-edge nginx -t >/dev/null 2>&1; then
  log "edge still has stale nginx.conf inode; recreate edge-nginx"
  docker compose up -d --no-deps --force-recreate edge-nginx
else
  docker exec ha-edge nginx -s reload 2>/dev/null || true
fi

wait_http "${EDGE_URL}" "edge-after" 15 || wait_http "${PUBLIC_HEALTH}" "public-after" 15

PG_AFTER="$(pg_started_at)"
if [[ -n "${PG_BEFORE}" && -n "${PG_AFTER}" && "${PG_BEFORE}" != "${PG_AFTER}" ]]; then
  echo "error: postgres was restarted (${PG_BEFORE} -> ${PG_AFTER})" >&2
  exit 1
fi
log "postgres uptime unchanged"
log "rolling update done"
