#!/usr/bin/env bash
# 在线安装 Incus（Zabbly stable）— 依赖由 apt 按本机补丁级别解析，适配 jammy/noble/resolute。
set -euo pipefail

if ! declare -f ha_os_detect >/dev/null 2>&1; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=os-detect.sh
  source "${SCRIPT_DIR}/os-detect.sh"
fi

ha_incus_install_online() {
  ha_os_detect
  export DEBIAN_FRONTEND=noninteractive

  echo "==> install incus online (${HA_OS_CODENAME}/${HA_OS_DEB_ARCH}) via Zabbly"

  if declare -f ha_apt_mirror_apply >/dev/null 2>&1; then
    ha_apt_mirror_apply "${HA_OS_CODENAME}" "${HA_OS_DEB_ARCH}" || true
  fi
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg

  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc

  cat >/etc/apt/sources.list.d/zabbly-incus-stable.sources <<EOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: ${HA_OS_CODENAME}
Components: main
Architectures: ${HA_OS_DEB_ARCH}
Signed-By: /etc/apt/keyrings/zabbly.asc
EOF

  apt-get update -qq
  if ! apt-cache show incus >/dev/null 2>&1; then
    echo "error: incus package not in apt index (${HA_OS_CODENAME}/${HA_OS_DEB_ARCH})" >&2
    apt-cache policy incus 2>&1 | tail -8 >&2 || true
    return 1
  fi

  if ! apt-get install -y -qq incus; then
    echo "error: apt install incus failed on ${HA_OS_CODENAME}" >&2
    return 1
  fi
  systemctl enable --now incus 2>/dev/null || true

  if ! command -v incus >/dev/null 2>&1; then
    echo "error: incus missing after apt install" >&2
    return 1
  fi
  echo "==> incus $(incus version 2>/dev/null | head -1 || true)"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ha_incus_install_online
fi
