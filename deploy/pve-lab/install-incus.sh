#!/usr/bin/env bash
# 在 Worker VM 上单独安装 Incus + 导入 ha-ubuntu-24.04 镜像
set -euo pipefail

HA_INCUS_IMAGE="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
NODE_NAME="${NODE_NAME:-$(hostname)}"

if ! command -v incus >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq incus
fi
incus admin init --auto 2>/dev/null || true

if ! incus image list -c l --format csv 2>/dev/null | grep -qx "${HA_INCUS_IMAGE}"; then
  echo "==> copy ubuntu 24.04 cloud → ${HA_INCUS_IMAGE}"
  incus image copy images:ubuntu/24.04/cloud local: --alias "${HA_INCUS_IMAGE}" || true
fi

incus image list
echo "==> incus ready on ${NODE_NAME}"
