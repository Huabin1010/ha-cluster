#!/usr/bin/env bash
# ha-cluster 一键加节点（瘦引导 → Depot 分系统安装）
#
#   curl -fsSL "${HA_DEPOT_PUBLIC}/install.sh" | sudo bash -s join --token 'ha://join/...'
#
# HA_INSTALL_MODE=auto|online|offline  （默认 auto：能连 Zabbly 则在线 apt 装 Incus）
set -euo pipefail

DEPOT_PUBLIC="${HA_DEPOT_PUBLIC:-https://rustfs.s.ggss.club:50000/typora/ha-cluster}"
SETUP_DIR="${HA_SETUP_DIR:-/var/lib/ha-setup}"
CACHE="${HA_SETUP_CACHE:-/var/lib/ha-setup/cache}"
INSTALL_MODE="${HA_INSTALL_MODE:-auto}"

arch="$(uname -m)"
case "${arch}" in
  x86_64) goarch="amd64" ;;
  aarch64|arm64) goarch="arm64" ;;
  *)
    echo "unsupported arch: ${arch}" >&2
    exit 1
    ;;
esac

payload_dir="payload-linux-${goarch}"
setup_url="${DEPOT_PUBLIC}/bin/${goarch}/ha-setup"
payload_url="${DEPOT_PUBLIC}/bundles/${goarch}/payload.tar.zst"
lab_base="${DEPOT_PUBLIC}/lab"

mkdir -p "${SETUP_DIR}" "${CACHE}"
cd "${SETUP_DIR}"

if [[ ! -x ./ha-setup ]]; then
  echo ">> fetching ha-setup (${goarch}) ..."
  if ! curl -fsSL "${setup_url}" -o ha-setup; then
    curl -fsSL "${DEPOT_PUBLIC}/ha-setup-linux-${goarch}" -o ha-setup
  fi
  chmod +x ha-setup
fi

cmd="${1:-}"
shift || true

case "${cmd}" in
  join)
    echo ">> ha-setup join ..."
    export HA_DEPOT_PUBLIC
    ./ha-setup join "$@"

    if [[ -f "${SETUP_DIR}/join.env" ]]; then
      # shellcheck disable=SC1091
      source "${SETUP_DIR}/join.env"
    fi
    export DEPOT_PUBLIC="${HA_DEPOT_PUBLIC:-${DEPOT_PUBLIC}}"
    export STAGING="${DEPOT_PUBLIC}"
    export HA_INSTALL_MODE="${INSTALL_MODE}"
    export HA_API_BASE="${HA_API:-}"
    export HA_NODE_TOKEN="${HA_NODE_TOKEN:-}"

    echo ">> worker install (mode=${HA_INSTALL_MODE}) from ${lab_base} ..."
    INSTALL_ROOT="/tmp/ha-cluster-install"
    mkdir -p "${INSTALL_ROOT}"
    curl --connect-timeout 10 --max-time 60 -fsSL "${lab_base}/depot-paths.sh" -o "${INSTALL_ROOT}/depot-paths.sh"
    curl --connect-timeout 10 --max-time 60 -fsSL "${lab_base}/os-detect.sh" -o "${INSTALL_ROOT}/os-detect.sh"
    curl --connect-timeout 10 --max-time 120 -fsSL "${lab_base}/worker-install.sh" -o "${INSTALL_ROOT}/worker-install.sh"
    chmod 0755 "${INSTALL_ROOT}/worker-install.sh"
    # shellcheck disable=SC1091
    source "${INSTALL_ROOT}/depot-paths.sh"
    # shellcheck disable=SC1091
    source "${INSTALL_ROOT}/os-detect.sh"
    ha_os_detect
    echo ">> detected: $(ha_os_suite_label) / ${HA_OS_DEB_ARCH}"
    exec bash "${INSTALL_ROOT}/worker-install.sh"
    ;;
  detect)
    tmp="$(mktemp)"
    curl -fsSL "${lab_base}/os-detect.sh" -o "${tmp}"
    # shellcheck disable=SC1090
    source "${tmp}"
    ha_os_detect
    echo "label=$(ha_os_suite_label) arch=${HA_OS_DEB_ARCH}"
    rm -f "${tmp}"
    exec ./ha-setup detect
    ;;
  *)
    # legacy: 仅拉 payload + ha-setup 子命令
    if [[ -n "${HA_PAYLOAD_FILE:-}" && -f "${HA_PAYLOAD_FILE}" ]]; then
      export HA_PAYLOAD_FILE
    elif [[ ! -d "${CACHE}/${payload_dir}" ]]; then
      echo ">> fetching offline payload (${goarch}) ..."
      local_payload="${CACHE}/payload.tar.zst"
      if ! curl -fsSL "${payload_url}" -o "${local_payload}"; then
        curl -fsSL "${DEPOT_PUBLIC}/ha-payload-linux-${goarch}.tar.zst" -o "${local_payload}"
      fi
      mkdir -p "${CACHE}/${payload_dir}"
      if command -v zstd >/dev/null 2>&1; then
        zstd -d -f "${local_payload}" -o "${CACHE}/payload.tar"
        tar -xf "${CACHE}/payload.tar" -C "${CACHE}/${payload_dir}" --strip-components=1 2>/dev/null \
          || tar -xf "${CACHE}/payload.tar" -C "${CACHE}"
      else
        echo "error: need zstd to unpack payload" >&2
        exit 1
      fi
      export HA_PAYLOAD_FILE="${CACHE}/${payload_dir}"
    fi
    export HA_DEPOT_PUBLIC
    export HA_DEPOT="${HA_DEPOT:-${HA_DEPOT_PUBLIC}}"
    exec ./ha-setup "${cmd}" "$@"
    ;;
esac
