#!/usr/bin/env bash
# ha-cluster 一键加节点（瘦引导脚本，从 Depot/CDN 拉离线 payload）
#
#   curl -fsSL "${HA_DEPOT_PUBLIC}/install.sh" | sudo bash -s join --token 'ha://join/...'
#
# 环境变量（可选）：
#   HA_DEPOT_PUBLIC  制品根 URL，末尾无斜杠
#   HA_PAYLOAD_FILE  本地 payload 路径（跳过下载）
set -euo pipefail

DEPOT_PUBLIC="${HA_DEPOT_PUBLIC:-https://rustfs.s.ggss.club:50000/typora/ha-cluster}"
SETUP_DIR="${HA_SETUP_DIR:-/var/lib/ha-setup}"
CACHE="${HA_SETUP_CACHE:-/var/lib/ha-setup/cache}"

arch="$(uname -m)"
case "${arch}" in
  x86_64) goarch="amd64" ;;
  aarch64|arm64) goarch="arm64" ;;
  *)
    echo "unsupported arch: ${arch}" >&2
    exit 1
    ;;
esac

payload_name="ha-payload-linux-${goarch}.tar.zst"
payload_dir="payload-linux-${goarch}"

mkdir -p "${SETUP_DIR}" "${CACHE}"
cd "${SETUP_DIR}"

if [[ ! -x ./ha-setup ]]; then
  echo ">> fetching ha-setup (${goarch}) ..."
  curl -fsSL "${DEPOT_PUBLIC}/ha-setup-linux-${goarch}" -o ha-setup
  chmod +x ha-setup
fi

if [[ -n "${HA_PAYLOAD_FILE:-}" && -f "${HA_PAYLOAD_FILE}" ]]; then
  export HA_PAYLOAD_FILE
elif [[ ! -d "${CACHE}/${payload_dir}" ]]; then
  echo ">> fetching offline payload ${payload_name} (may take a while) ..."
  curl -fsSL "${DEPOT_PUBLIC}/${payload_name}" -o "${CACHE}/${payload_name}"
  mkdir -p "${CACHE}/${payload_dir}"
  if command -v zstd >/dev/null 2>&1; then
    zstd -d -f "${CACHE}/${payload_name}" -o "${CACHE}/${payload_name}.tar"
    tar -xf "${CACHE}/${payload_name}.tar" -C "${CACHE}/${payload_dir}" --strip-components=1 2>/dev/null \
      || tar -xf "${CACHE}/${payload_name}.tar" -C "${CACHE}"
  else
    echo "error: need zstd to unpack ${payload_name}" >&2
    exit 1
  fi
  export HA_PAYLOAD_FILE="${CACHE}/${payload_dir}"
fi

export HA_DEPOT_PUBLIC
if [[ -z "${HA_DEPOT:-}" ]]; then
  export HA_DEPOT="${HA_DEPOT_PUBLIC}"
fi
exec ./ha-setup "$@"
