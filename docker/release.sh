#!/bin/bash

# 使脚本在遇到任何错误时自动退出
set -e

# 定义一个错误处理函数
error_handler() {
    local exit_code=$?
    local line_no=$1
    echo "Error on line $line_no. Exit code: $exit_code"
    exit $exit_code
}

# 使用trap命令捕获错误并调用错误处理函数
trap 'error_handler $LINENO' ERR

# 解析参数：--no-latest 或 -n 表示不构建/推送 latest 标签
NO_LATEST=false
if [[ "$1" == "--no-latest" ]] || [[ "$1" == "-n" ]]; then
    NO_LATEST=true
    echo "Mode: 不推送 latest 标签"
fi

VERSION=$(date +%Y%m%d%H%M)
BACK_IMAGE_NAME=ghcr.io/huabin1010/ha-cluster/ha-api

echo "=========================================="
echo "版本标签: $VERSION"
echo "镜像: $BACK_IMAGE_NAME"
echo "=========================================="

# 编译镜像
echo "Building image..."
export DOCKER_BUILDKIT=1

# 切换到项目根目录执行 build
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$NO_LATEST" == true ]]; then
    docker build -f ./docker/Dockerfile -t "$BACK_IMAGE_NAME:$VERSION" .
else
    docker build -f ./docker/Dockerfile -t "$BACK_IMAGE_NAME:latest" -t "$BACK_IMAGE_NAME:$VERSION" .
fi
echo "Build complete."

echo "Pushing images to GitHub Container Registry (ghcr.io)..."

if [[ "$NO_LATEST" != true ]]; then
    echo ">>> Pushing $BACK_IMAGE_NAME:latest"
    docker push "$BACK_IMAGE_NAME:latest"
fi
echo ">>> Pushing $BACK_IMAGE_NAME:$VERSION"
docker push "$BACK_IMAGE_NAME:$VERSION"

echo "=========================================="
echo "Push complete. 已推送标签:"
if [[ "$NO_LATEST" != true ]]; then
    echo "  - latest"
fi
echo "  - $VERSION"
echo "=========================================="
