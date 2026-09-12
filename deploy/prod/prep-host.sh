#!/usr/bin/env bash
# 在 42 上安装/扩容 swap、准备 docker 目录（阶段 0）
set -euo pipefail

SWAP_GB="${HA_SWAP_GB:-4}"
SWAP_FILE="${HA_SWAP_FILE:-/www/ha-cluster-swap}"
DEPLOY_DIR="${HA_DEPLOY_DIR:-/www/wwwroot/cl.qzsyzn.com/docker}"

echo "==> memory"
free -h

need_swap=1
if [[ -f "${SWAP_FILE}" ]]; then
  if swapon --show | grep -q "${SWAP_FILE}"; then
    echo "==> swap already active: ${SWAP_FILE}"
    need_swap=0
  fi
fi

if [[ "${need_swap}" == "1" ]]; then
  echo "==> creating ${SWAP_GB}G swap at ${SWAP_FILE}"
  if [[ ! -f "${SWAP_FILE}" ]]; then
    if command -v fallocate >/dev/null 2>&1; then
      fallocate -l "${SWAP_GB}G" "${SWAP_FILE}"
    else
      dd if=/dev/zero of="${SWAP_FILE}" bs=1M count=$((SWAP_GB * 1024)) status=progress
    fi
    chmod 600 "${SWAP_FILE}"
    mkswap "${SWAP_FILE}"
  fi
  swapon "${SWAP_FILE}" || true
  if ! grep -q "${SWAP_FILE}" /etc/fstab 2>/dev/null; then
    echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
  fi
fi

swapon --show
free -h

echo "==> deploy dir ${DEPLOY_DIR}"
mkdir -p "${DEPLOY_DIR}"
chown -R www:www /www/wwwroot/cl.qzsyzn.com || true

if ! command -v docker >/dev/null; then
  echo "error: docker required" >&2
  exit 1
fi
docker compose version

echo "==> prep done"
