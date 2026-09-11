#!/usr/bin/env bash
# 单台 VM：重置 + 安装（一次 guest exec 完成，约 15–30s）
set -euo pipefail

: "${STAGING:?STAGING required}"
: "${NODE_NAME:?NODE_NAME required}"
: "${FABRIC_IP:?FABRIC_IP required}"

ROOT="/tmp/ha-pve-lab-install"
mkdir -p "${ROOT}"

curl --connect-timeout 5 --max-time 30 -fsSL "${STAGING%/}/lab/reset-worker.sh" -o "${ROOT}/reset.sh"
bash "${ROOT}/reset.sh"

curl --connect-timeout 5 --max-time 30 -fsSL "${STAGING%/}/lab/install.sh" -o "${ROOT}/install.sh"
bash "${ROOT}/install.sh"
