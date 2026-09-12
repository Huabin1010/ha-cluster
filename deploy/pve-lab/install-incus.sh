#!/usr/bin/env bash
# Incus 安装统一入口：auto = 能连 Zabbly 则在线 apt，否则走 Depot 离线 bundle。
# 环境变量：HA_INSTALL_MODE=auto|online|offline
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="${HA_INSTALL_ROOT:-${SCRIPT_DIR}}"
mkdir -p "${INSTALL_ROOT}"

_ha_lab_base() {
  local base="${DEPOT_PUBLIC:-${STAGING:-}}"
  echo "${base%/}/lab"
}

ha_fetch_lab_script() {
  local name="$1"
  local dest="${INSTALL_ROOT}/${name}"
  curl --connect-timeout 10 --max-time 120 -fsSL "$(ha_lab_url "${name}")" -o "${dest}"
  chmod 0755 "${dest}" 2>/dev/null || true
  # shellcheck disable=SC1090
  source "${dest}"
}

# bootstrap depot-paths（ha_lab_url 依赖它）
curl --connect-timeout 10 --max-time 30 -fsSL "$(_ha_lab_base)/depot-paths.sh" -o "${INSTALL_ROOT}/depot-paths.sh"
# shellcheck disable=SC1091
source "${INSTALL_ROOT}/depot-paths.sh"
export DEPOT_PUBLIC="${DEPOT_PUBLIC:-${STAGING:-}}"

# 始终从 Depot 拉最新子脚本（避免 VM /tmp 缓存旧版）
ha_fetch_lab_script os-detect.sh
ha_fetch_lab_script ubuntu-apt-mirror.sh
ha_fetch_lab_script incus-offline.sh
ha_fetch_lab_script install-incus-online.sh

ha_sanitize_env() {
  HA_INSTALL_MODE="${HA_INSTALL_MODE:-auto}"
  HA_APT_MIRROR="${HA_APT_MIRROR:-}"
  SKIP_INCUS="${SKIP_INCUS:-0}"
  HA_INSTALL_MODE="${HA_INSTALL_MODE//$'\r'/}"
  HA_APT_MIRROR="${HA_APT_MIRROR//$'\r'/}"
  SKIP_INCUS="${SKIP_INCUS//$'\r'/}"
}

ha_pick_install_mode() {
  ha_sanitize_env
  local mode="${HA_INSTALL_MODE:-auto}"
  case "${mode}" in
    online | offline) echo "${mode}"; return 0 ;;
    auto)
      # 实验室：apt 走清华源，Incus/Zabbly 等外网组件走 Depot 离线包
      if [[ "${HA_APT_MIRROR:-}" == "tuna" ]]; then
        echo "offline"
      elif ha_can_reach_url "https://pkgs.zabbly.com/key.asc"; then
        echo "online"
      else
        echo "offline"
      fi
      ;;
    *)
      echo "error: invalid HA_INSTALL_MODE=${mode}" >&2
      return 1
      ;;
  esac
}

ha_incus_install_worker() {
  local bundle_dir="${1:-${INSTALL_ROOT}/incus-bundle}"
  local mode
  mode="$(ha_pick_install_mode)"
  ha_os_detect
  ha_apt_mirror_apply "${HA_OS_CODENAME}" "${HA_OS_DEB_ARCH}" || true
  echo "==> incus install mode=${mode} os=$(ha_os_suite_label) apt=${HA_APT_MIRROR:-default}"

  if [[ "${mode}" == "online" ]]; then
    ha_incus_install_online
    ha_incus_init
    ha_incus_ensure_profile
    ha_incus_ensure_quota_pool
    ha_incus_network_fixup
    ha_incus_network_persist
    ha_incus_fetch_workspace_assets "${bundle_dir}"
    ha_incus_import_image "${bundle_dir}"
    ha_incus_bake_docker_image_smart
    ha_incus_network_fixup
  else
    ha_incus_prepare_bundle "$(ha_bundle_url incus-offline.tar.zst)" "${bundle_dir}"
    ha_incus_offline_install "${bundle_dir}"
  fi

  incus image list 2>/dev/null || true
  echo "==> incus ready ($(ha_os_suite_label))"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ha_incus_install_worker "${1:-}"
fi
