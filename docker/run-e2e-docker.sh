#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.e2e.yaml"

if docker compose version &>/dev/null; then
    DC="docker compose"
elif command -v docker-compose &>/dev/null; then
    DC="docker-compose"
else
    echo "[ERROR] 未找到 docker compose 或 docker-compose 命令！"
    exit 1
fi

echo "============================================================"
echo "  HA-Cluster Docker 真实环境 E2E Playwright 测试启动器"
echo "============================================================"

# 1. 检查宿主机 Incus 状态
if [[ ! -S /var/lib/incus/unix.socket ]]; then
    echo "[ERROR] 未检测到 /var/lib/incus/unix.socket，请确认宿主机 Incus 服务已启动。"
    exit 1
fi
echo "[OK] 宿主机 Incus Unix Socket 状态正常"

cleanup() {
    echo ">>> 清理测试容器与网络资源..."
    $DC -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
}

if [[ "$1" == "--down" ]]; then
    cleanup
    echo "[OK] 测试容器已清理退出"
    exit 0
fi

if [[ "$1" == "--server-only" ]] || [[ "$1" == "-s" ]]; then
    echo ">>> 模式：仅启动测试服务容器 (ha-api-test) ..."
    $DC -f "$COMPOSE_FILE" up -d --build ha-api-test
    echo ">>> 等待服务健康检查就绪 (http://127.0.0.1:18088/healthz) ..."
    for i in {1..30}; do
        if curl -sf http://127.0.0.1:18088/healthz >/dev/null; then
            echo "[OK] 测试服务已就绪！监听地址：http://127.0.0.1:18088"
            echo "你现在可以在宿主机直接运行："
            echo "  cd web && E2E_BASE_URL=http://127.0.0.1:18088 E2E_API_URL=http://127.0.0.1:18088 E2E_SKIP_WEBSERVER=1 npm run test:e2e:journey"
            exit 0
        fi
        sleep 1
    done
    echo "[ERROR] 服务健康检查超时！"
    exit 1
fi

# 全容器化执行模式
trap cleanup EXIT INT TERM

echo ">>> [1/3] 构建并启动后台 ha-api 容器服务..."
$DC -f "$COMPOSE_FILE" up -d --build ha-api-test

echo ">>> [2/3] 等待 ha-api 服务就绪..."
READY=false
for i in {1..30}; do
    if curl -sf http://127.0.0.1:18088/healthz >/dev/null; then
        READY=true
        break
    fi
    sleep 1
done

if [[ "$READY" != true ]]; then
    echo "[ERROR] ha-api 测试服务未能在规定时间内就绪！"
    $DC -f "$COMPOSE_FILE" logs ha-api-test
    exit 1
fi
echo "[OK] ha-api 服务已就绪 (http://127.0.0.1:18088)"

echo ">>> [3/3] 执行端到端完整用户流程 E2E 测试..."
if [[ "$1" == "--docker-runner" ]]; then
    echo ">>> 运行模式：在 Playwright Docker 容器内执行测试..."
    $DC -f "$COMPOSE_FILE" run --rm playwright-runner
else
    echo ">>> 运行模式：针对 Docker 容器环境执行真实全流程测试..."
    (
        cd "$ROOT_DIR/web"
        E2E_BASE_URL=http://127.0.0.1:18088 \
        E2E_API_URL=http://127.0.0.1:18088 \
        E2E_SKIP_WEBSERVER=1 \
        npx playwright test e2e-real/user-journey-flow.spec.ts --config playwright.real.config.ts
    )
fi

echo "============================================================"
echo "  [SUCCESS] Docker 真实环境 E2E Playwright 全流程测试执行通过！"
echo "  HTML 报告已生成至: web/playwright-report-real/index.html"
echo "============================================================"
