#!/usr/bin/env bash
# 配置 Ubuntu apt 清华源（jammy / noble / resolute）。
#   HA_APT_MIRROR=tuna   — 启用（实验室默认）
#   HA_APT_MIRROR=       — 跳过，保留系统原有源
#
# 用法：
#   source ubuntu-apt-mirror.sh && ha_apt_mirror_apply
#   HA_UBUNTU_CODENAME=noble bash ubuntu-apt-mirror.sh apply
set -euo pipefail

HA_APT_MIRROR="${HA_APT_MIRROR:-tuna}"
TUNA_UBUNTU="${TUNA_UBUNTU_URL:-https://mirrors.tuna.tsinghua.edu.cn/ubuntu}"
TUNA_PORTS="${TUNA_PORTS_URL:-https://mirrors.tuna.tsinghua.edu.cn/ubuntu-ports}"

ha_apt_mirror_codename() {
  if [[ -n "${HA_UBUNTU_CODENAME:-}" ]]; then
    echo "${HA_UBUNTU_CODENAME}"
    return 0
  fi
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "${VERSION_CODENAME:-jammy}"
    return 0
  fi
  echo "jammy"
}

ha_apt_mirror_arch() {
  case "$(dpkg --print-architecture 2>/dev/null || uname -m)" in
    amd64 | x86_64) echo "amd64" ;;
    arm64 | aarch64) echo "arm64" ;;
    *) echo "amd64" ;;
  esac
}

ha_apt_mirror_apply() {
  local codename="${1:-$(ha_apt_mirror_codename)}"
  local arch="${2:-$(ha_apt_mirror_arch)}"
  HA_APT_MIRROR="${HA_APT_MIRROR//$'\r'/}"

  if [[ "${HA_APT_MIRROR}" != "tuna" ]]; then
    echo "==> apt mirror skipped (HA_APT_MIRROR=${HA_APT_MIRROR})"
    return 0
  fi

  case "${codename}" in
    jammy | noble | resolute) ;;
    *)
      echo "error: unsupported codename for tuna mirror: ${codename}" >&2
      return 1
      ;;
  esac

  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq ca-certificates 2>/dev/null || true

  local uri="${TUNA_UBUNTU}"
  if [[ "${arch}" == "arm64" ]]; then
    uri="${TUNA_PORTS}"
  fi

  echo "==> apt mirror: tuna (${codename}/${arch})"

  if [[ -f /etc/apt/sources.list ]]; then
    mv /etc/apt/sources.list /etc/apt/sources.list.bak.ha-cluster 2>/dev/null || true
  fi
  rm -f /etc/apt/sources.list.d/ubuntu.sources \
    /etc/apt/sources.list.d/*ubuntu*.list 2>/dev/null || true

  cat >/etc/apt/sources.list.d/ubuntu-tuna.sources <<EOF
Types: deb
URIs: ${uri}
Suites: ${codename} ${codename}-updates ${codename}-backports ${codename}-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF

  apt-get update -qq
  echo "==> apt mirror ready (${uri})"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-apply}" in
    apply) ha_apt_mirror_apply ;;
    *)
      echo "usage: $0 apply" >&2
      exit 2
      ;;
  esac
fi
