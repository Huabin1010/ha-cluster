#!/usr/bin/env bash
# T4 · Path A on this machine: ha-api (HA_RUNTIME=incus) + Incus + ha-agent heartbeat.
# Does NOT touch OpenResty, sshd, or packaging/pack.sh contents.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.local/go/bin:${ROOT}/bin:${PATH}"

API_ADDR="${HA_API_ADDR:-127.0.0.1:8080}"
API_URL="http://${API_ADDR}"
ADMIN_PASS="${HA_ADMIN_PASSWORD:-123456qq}"
JWT_SECRET="${HA_JWT_SECRET:-dev-insecure-change-me-please-32b}"
NODE_NAME="${HA_NODE_NAME:-dev-pc}"
FABRIC_IP="${HA_FABRIC_IP:-192.168.1.148}"
CLASS="${HA_CLASS:-desktop}"
POWER="${HA_POWER:-mains}"
WORKDIR="${HA_T4_WORKDIR:-/tmp/ha-t4-path-a}"
PIDFILE="${WORKDIR}/ha-api.pid"
LOGFILE="${WORKDIR}/ha-api.log"

mkdir -p "${WORKDIR}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }

sudo_auth() {
  if sudo -n true 2>/dev/null; then
    return 0
  fi
  if [[ -n "${SUDO_PASSWORD:-}" ]]; then
    echo "${SUDO_PASSWORD}" | sudo -S -v
    return $?
  fi
  sudo -v
}

install_incus_if_needed() {
  if command -v incus >/dev/null 2>&1; then
    echo "incus already present: $(command -v incus)"
    return
  fi
  echo "installing incus (apt) — T3 payload preferred when available; Path A needs a local CLI now"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y incus
  # bare init for unprivileged-ish lab; may require group membership
  if ! incus info >/dev/null 2>&1; then
    sudo incus admin init --auto || true
    sudo usermod -aG incus-admin "${USER}" || sudo usermod -aG incus "${USER}" || true
    echo "NOTE: re-login may be required for incus group; trying sudo incus for this run"
  fi
}

incus_bin() {
  if incus info >/dev/null 2>&1; then
    echo incus
  else
    echo "sudo incus"
  fi
}

build() {
  make -C "${ROOT}" build
}

start_api() {
  if [[ -f "${PIDFILE}" ]] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
    echo "ha-api already running pid=$(cat "${PIDFILE}")"
    return
  fi
  USE_SUDO=0
  if ! incus info >/dev/null 2>&1; then
    USE_SUDO=1
    sudo_auth || { echo "sudo required for incus/ha-api on this host" >&2; exit 1; }
    echo "incus requires elevated access on this host — starting ha-api via sudo"
  fi
  if [[ "${USE_SUDO}" == "1" ]]; then
    sudo env \
      HA_API_ADDR="${API_ADDR}" \
      HA_RUNTIME=incus \
      HA_JWT_SECRET="${JWT_SECRET}" \
      HA_ADMIN_PASSWORD="${ADMIN_PASS}" \
      HA_INCUS_IMAGE="${HA_INCUS_IMAGE:-images:ubuntu/24.04}" \
      "${ROOT}/bin/ha-api" >"${LOGFILE}" 2>&1 &
  else
    env \
      HA_API_ADDR="${API_ADDR}" \
      HA_RUNTIME=incus \
      HA_JWT_SECRET="${JWT_SECRET}" \
      HA_ADMIN_PASSWORD="${ADMIN_PASS}" \
      HA_INCUS_IMAGE="${HA_INCUS_IMAGE:-images:ubuntu/24.04}" \
      "${ROOT}/bin/ha-api" >"${LOGFILE}" 2>&1 &
  fi
  echo $! >"${PIDFILE}"
  for i in $(seq 1 30); do
    if curl -fsS "${API_URL}/healthz" >/dev/null 2>&1; then
      echo "ha-api up at ${API_URL}"
      return
    fi
    sleep 0.3
  done
  echo "ha-api failed to start; log:" >&2
  tail -n 50 "${LOGFILE}" >&2 || true
  exit 1
}

login() {
  curl -fsS -X POST "${API_URL}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PASS}\"}" | tee "${WORKDIR}/login.json"
  TOKEN="$(python3 -c "import json;print(json.load(open('${WORKDIR}/login.json'))['token'])")"
  echo "${TOKEN}" >"${WORKDIR}/token"
}

heartbeat() {
  "${ROOT}/bin/ha-agent" \
    --api "${API_URL}" \
    --name "${NODE_NAME}" \
    --fabric-ip "${FABRIC_IP}" \
    --power "${POWER}" \
    --class "${CLASS}" \
    --once
}

create_project() {
  TOKEN="$(cat "${WORKDIR}/token")"
  curl -fsS -X POST "${API_URL}/projects" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"name":"t4-path-a","slug":"t4-path-a"}' | tee "${WORKDIR}/project.json"
  PROJECT_ID="$(python3 -c "import json;print(json.load(open('${WORKDIR}/project.json'))['id'])")"
  echo "${PROJECT_ID}" >"${WORKDIR}/project_id"
}

create_nano() {
  TOKEN="$(cat "${WORKDIR}/token")"
  PROJECT_ID="$(cat "${WORKDIR}/project_id")"
  curl -fsS -X POST "${API_URL}/projects/${PROJECT_ID}/workspaces" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"name":"t4-nano","plan":"nano","arch":"amd64"}' | tee "${WORKDIR}/workspace.json"
}

list_nodes() {
  TOKEN="$(cat "${WORKDIR}/token")"
  curl -fsS -H "Authorization: Bearer ${TOKEN}" "${API_URL}/nodes" | tee "${WORKDIR}/nodes.json"
}

oversell_check() {
  TOKEN="$(cat "${WORKDIR}/token")"
  PROJECT_ID="$(cat "${WORKDIR}/project_id")"
  # Shrink node capacity via heartbeat, then try large until 409.
  "${ROOT}/bin/ha-agent" \
    --api "${API_URL}" \
    --name "${NODE_NAME}" \
    --fabric-ip "${FABRIC_IP}" \
    --power "${POWER}" \
    --class "${CLASS}" \
    --cpu-milli 1000 \
    --mem-bytes $((512 * 1024 * 1024)) \
    --disk-bytes $((10 * 1024 * 1024 * 1024)) \
    --once
  code="$(curl -sS -o "${WORKDIR}/oversell.json" -w '%{http_code}' -X POST \
    "${API_URL}/projects/${PROJECT_ID}/workspaces" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"name":"t4-large-oversell","plan":"large","arch":"amd64"}')"
  echo "oversell HTTP ${code}"
  cat "${WORKDIR}/oversell.json"
  echo
  [[ "${code}" == "409" ]] || { echo "expected 409 INSUFFICIENT_CAPACITY" >&2; exit 1; }
  grep -q INSUFFICIENT_CAPACITY "${WORKDIR}/oversell.json"
}

incus_show() {
  echo "=== incus list ==="
  if incus info >/dev/null 2>&1; then
    incus list
  else
    sudo_auth && sudo incus list
  fi
}

case "${1:-all}" in
  install-incus) install_incus_if_needed ;;
  build) build ;;
  start-api) start_api ;;
  login) login ;;
  heartbeat) heartbeat ;;
  project) create_project ;;
  nano) create_nano ;;
  nodes) list_nodes ;;
  oversell) oversell_check ;;
  incus) incus_show ;;
  stop)
    if [[ -f "${PIDFILE}" ]]; then
      kill "$(cat "${PIDFILE}")" 2>/dev/null || true
      rm -f "${PIDFILE}"
    fi
    ;;
  all)
    need curl
    need python3
    install_incus_if_needed
    build
    start_api
    login
    heartbeat
    list_nodes
    create_project
    create_nano
    incus_show
    oversell_check
    echo
    echo "T4 Path A OK. Artifacts under ${WORKDIR}"
    echo "Stop API: $0 stop"
    ;;
  *)
    echo "usage: $0 {all|install-incus|build|start-api|login|heartbeat|project|nano|nodes|oversell|incus|stop}" >&2
    exit 2
    ;;
esac
