#!/usr/bin/env bash
# Depot URL 助手（与 packaging/depot_layout.py 键布局一致）
set -euo pipefail

ha_depot_base() {
  if [[ -n "${DEPOT_PUBLIC:-}" ]]; then
    echo "${DEPOT_PUBLIC%/}"
    return
  fi
  if [[ -n "${STAGING:-}" ]]; then
    echo "${STAGING%/}"
    return
  fi
  # 实验室默认局域网 RustFS；生产 join 请设 DEPOT_PUBLIC 为公网 URL
  echo "http://192.168.1.9:10000/typora/ha-cluster"
}

ha_depot_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo "amd64" ;;
    aarch64 | arm64) echo "arm64" ;;
    *) echo "${ARCH:-amd64}" ;;
  esac
}

ha_lab_url() {
  echo "$(ha_depot_base)/lab/${1}"
}

ha_bin_url() {
  local arch
  arch="$(ha_depot_arch)"
  echo "$(ha_depot_base)/bin/${arch}/${1}"
}

ha_bundle_url() {
  local arch name
  arch="$(ha_depot_arch)"
  name="${1:-incus-offline.tar.zst}"
  echo "$(ha_depot_base)/bundles/${arch}/${name}"
}

# workspace 底镜像（在线安装只拉这一文件，不必下 517MB incus-offline bundle）
ha_workspace_image_url() {
  local arch series
  arch="$(ha_depot_arch)"
  series="${HA_UBUNTU_SERIES:-24.04}"
  echo "$(ha_depot_base)/bundles/${arch}/images/ubuntu-${series}-server-cloudimg-${arch}-root.tar.xz"
}

ha_workspace_debs_bundle_url() {
  echo "$(ha_bundle_url workspace-debs.tar.zst)"
}
