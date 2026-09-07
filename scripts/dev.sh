#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

export PATH="${HOME}/.local/go/bin:${HOME}/go/bin:${PATH}"

cd "${ROOT_DIR}"

if ! command -v air &>/dev/null; then
  echo ">>> 未检测到 air，正在自动安装..."
  go install github.com/air-verse/air@latest
fi

PORT="${HA_API_ADDR:-:8080}"
CHECK_PORT="${PORT#:}"
CHECK_PORT="${CHECK_PORT##*:}"

if ss -tulpn | grep -q ":${CHECK_PORT} "; then
  PID=$(ss -tulpn | grep ":${CHECK_PORT} " | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -n 1 || true)
  if [ -n "${PID}" ]; then
    CMD=$(ps -p "${PID}" -o comm= 2>/dev/null || true)
    if [[ "${CMD}" == *"ha-api"* ]]; then
      echo ">>> 端口 ${CHECK_PORT} 被旧后台进程 (PID: ${PID}, ${CMD}) 占用，正在自动释放..."
      kill -9 "${PID}" 2>/dev/null || true
      sleep 0.5
    else
      echo ">>> 注意：端口 ${CHECK_PORT} 当前已被占用 (PID: ${PID:-未知}, ${CMD})。"
      echo ">>> 如果是旧版后台 ha-api 进程，可在另一个终端执行以下命令释放："
      echo "    sudo kill -9 \$(pgrep -f ha-api)"
      echo ">>> 或者设置新端口启动，例如："
      echo "    HA_API_ADDR=:8088 ./scripts/dev.sh"
      echo ""
    fi
  fi
fi

echo ">>> 启动 Go 热重载开发服务 (air)..."
exec air
