#!/usr/bin/env bash
# 识别宿主机 OS / arch，供 install 脚本按系统分支（宝塔式）。
# shellcheck shell=bash
set -euo pipefail

ha_os_detect() {
  HA_OS_ID=""
  HA_OS_VERSION_ID=""
  HA_OS_CODENAME=""
  HA_OS_DEB_ARCH=""
  HA_OS_UNAME=""

  if [[ ! -r /etc/os-release ]]; then
    echo "error: /etc/os-release missing" >&2
    return 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  HA_OS_ID="${ID:-}"
  HA_OS_VERSION_ID="${VERSION_ID:-}"
  HA_OS_CODENAME="${VERSION_CODENAME:-}"

  case "$(uname -m)" in
    x86_64) HA_OS_UNAME="x86_64"; HA_OS_DEB_ARCH="amd64" ;;
    aarch64 | arm64) HA_OS_UNAME="aarch64"; HA_OS_DEB_ARCH="arm64" ;;
    *)
      echo "error: unsupported machine: $(uname -m)" >&2
      return 1
      ;;
  esac

  if [[ "${HA_OS_ID}" != "ubuntu" ]]; then
    echo "error: only Ubuntu workers supported (got ${HA_OS_ID})" >&2
    return 1
  fi

  case "${HA_OS_CODENAME}" in
    jammy | noble | resolute) ;;
    *)
      echo "error: unsupported Ubuntu ${HA_OS_VERSION_ID} (${HA_OS_CODENAME}); need 22.04/24.04/26.04" >&2
      return 1
      ;;
  esac

  export HA_OS_ID HA_OS_VERSION_ID HA_OS_CODENAME HA_OS_DEB_ARCH HA_OS_UNAME
  return 0
}

ha_os_suite_label() {
  case "${HA_OS_CODENAME:-}" in
    jammy) echo "Ubuntu 22.04 LTS (jammy)" ;;
    noble) echo "Ubuntu 24.04 LTS (noble)" ;;
    resolute) echo "Ubuntu 26.04 LTS (resolute)" ;;
    *) echo "unknown" ;;
  esac
}

ha_can_reach_url() {
  local url="$1"
  curl -fsSL --connect-timeout 5 --max-time 15 "${url}" >/dev/null 2>&1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ha_os_detect
  echo "id=${HA_OS_ID} version=${HA_OS_VERSION_ID} codename=${HA_OS_CODENAME} deb_arch=${HA_OS_DEB_ARCH}"
  echo "label=$(ha_os_suite_label)"
fi
