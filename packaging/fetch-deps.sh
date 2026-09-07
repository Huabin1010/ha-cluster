#!/usr/bin/env bash
# Download frozen third-party artifacts into packaging/cache/ for pack.sh.
# Usage: bash packaging/fetch-deps.sh [amd64|arm64|all]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=versions.env
source "${ROOT}/packaging/versions.env"

CACHE="${ROOT}/packaging/cache"
ARCH_ARG="${1:-all}"
mkdir -p "${CACHE}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing command: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd python3
need_cmd unzip
need_cmd sha256sum

download() {
  local url="$1" dest="$2"
  mkdir -p "$(dirname "${dest}")"
  if [[ -f "${dest}" && -s "${dest}" ]]; then
    echo "  skip (exists): ${dest}"
    return 0
  fi
  echo "  GET ${url}"
  # Resume partials; generous timeouts for large airgap/rootfs over flaky links.
  curl -fL --retry 8 --retry-delay 5 --retry-all-errors \
    --connect-timeout 30 --max-time 0 \
    -C - -o "${dest}.partial" "${url}"
  mv "${dest}.partial" "${dest}"
}

k3s_asset_url() {
  local file="$1"
  # GitHub release tag contains '+'; percent-encode for path.
  local tag_enc
  tag_enc="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${K3S_VERSION}")"
  echo "https://github.com/k3s-io/k3s/releases/download/${tag_enc}/${file}"
}

et_arch_name() {
  case "$1" in
    amd64) echo "x86_64" ;;
    arm64) echo "aarch64" ;;
    *) echo "unsupported arch: $1" >&2; exit 1 ;;
  esac
}

k3s_bin_name() {
  case "$1" in
    amd64) echo "k3s" ;;
    arm64) echo "k3s-arm64" ;;
    *) echo "unsupported arch: $1" >&2; exit 1 ;;
  esac
}

cloud_arch_name() {
  case "$1" in
    amd64) echo "amd64" ;;
    arm64) echo "arm64" ;;
    *) echo "unsupported arch: $1" >&2; exit 1 ;;
  esac
}

fetch_arch() {
  local arch="$1"
  local dir="${CACHE}/${arch}"
  mkdir -p "${dir}/k3s" "${dir}/easytier" "${dir}/images" "${dir}/debs"

  echo "==> fetch ${arch}"

  local k3s_bin
  k3s_bin="$(k3s_bin_name "${arch}")"
  download "$(k3s_asset_url "${k3s_bin}")" "${dir}/k3s/${k3s_bin}"
  chmod +x "${dir}/k3s/${k3s_bin}"
  # Canonical name inside cache for pack.sh (arm64 asset is k3s-arm64).
  if [[ "${k3s_bin}" != "k3s" ]]; then
    cp -f "${dir}/k3s/${k3s_bin}" "${dir}/k3s/k3s"
    chmod +x "${dir}/k3s/k3s"
  fi

  download "$(k3s_asset_url "k3s-airgap-images-${arch}.tar.zst")" \
    "${dir}/k3s/k3s-airgap-images-${arch}.tar.zst"

  download "https://get.k3s.io" "${dir}/k3s/install.sh"
  chmod +x "${dir}/k3s/install.sh"

  local et_arch et_zip et_url
  et_arch="$(et_arch_name "${arch}")"
  et_zip="easytier-linux-${et_arch}-${EASYTIER_VERSION}.zip"
  et_url="https://github.com/EasyTier/EasyTier/releases/download/${EASYTIER_VERSION}/${et_zip}"
  download "${et_url}" "${dir}/easytier/${et_zip}"
  local et_extract="${dir}/easytier/extract"
  rm -rf "${et_extract}"
  mkdir -p "${et_extract}"
  unzip -qo "${dir}/easytier/${et_zip}" -d "${et_extract}"
  # Zip layout varies: top-level dir or flat.
  local core
  core="$(find "${et_extract}" -type f -name 'easytier-core' | head -n1)"
  if [[ -z "${core}" ]]; then
    echo "error: easytier-core not found in ${et_zip}" >&2
    exit 1
  fi
  cp -f "${core}" "${dir}/easytier/easytier-core"
  chmod +x "${dir}/easytier/easytier-core"
  local cli
  cli="$(find "${et_extract}" -type f -name 'easytier-cli' | head -n1 || true)"
  if [[ -n "${cli}" ]]; then
    cp -f "${cli}" "${dir}/easytier/easytier-cli"
    chmod +x "${dir}/easytier/easytier-cli"
  fi
  rm -rf "${et_extract}"

  local cloud_arch rootfs_name rootfs_url
  cloud_arch="$(cloud_arch_name "${arch}")"
  rootfs_name="ubuntu-${UBUNTU_CLOUD_SERIES}-server-cloudimg-${cloud_arch}-root.tar.xz"
  rootfs_url="https://cloud-images.ubuntu.com/releases/${UBUNTU_CLOUD_SERIES}/release/${rootfs_name}"
  download "${rootfs_url}" "${dir}/images/${rootfs_name}"

  fetch_debs "${arch}" "${dir}/debs"
}

fetch_debs() {
  local arch="$1" dest="$2"
  local suite pkg pool_host
  case "${arch}" in
    amd64) pool_host="http://archive.ubuntu.com/ubuntu" ;;
    arm64) pool_host="http://ports.ubuntu.com/ubuntu-ports" ;;
    *) echo "unsupported arch for debs: ${arch}" >&2; exit 1 ;;
  esac

  for suite in ${DEB_SUITES}; do
    mkdir -p "${dest}/${suite}"
    for pkg in ${DEB_PACKAGES}; do
      # Skip if any matching deb already cached.
      if compgen -G "${dest}/${suite}/${pkg}_*.deb" >/dev/null; then
        echo "  skip (exists): ${dest}/${suite}/${pkg}_*.deb"
        continue
      fi
      echo "  resolve ${suite}/${arch} ${pkg}"
      local found=""

      # Fast path: reuse filename from the other arch cache (same suite/version).
      local other
      case "${arch}" in
        amd64) other=arm64 ;;
        arm64) other=amd64 ;;
      esac
      if compgen -G "${CACHE}/${other}/debs/${suite}/${pkg}_*.deb" >/dev/null; then
        local sample ver
        sample="$(ls "${CACHE}/${other}/debs/${suite}/${pkg}_"*.deb | head -n1)"
        ver="$(basename "${sample}" | sed -E "s/^${pkg}_(.*)_${other}\\.deb$/\\1/")"
        if [[ -n "${ver}" && "${ver}" != "$(basename "${sample}")" ]]; then
          for component_path in \
            "pool/universe/s/shadow/${pkg}_${ver}_${arch}.deb" \
            "pool/main/s/shadow/${pkg}_${ver}_${arch}.deb"; do
            if curl -fsI --connect-timeout 15 --max-time 30 \
              "${pool_host}/${component_path}" >/dev/null 2>&1; then
              found="${component_path}"
              break
            fi
          done
        fi
      fi

      if [[ -z "${found}" ]]; then
        local idx component
        for component in universe main multiverse restricted; do
          idx="$(mktemp)"
          if curl -fsL --retry 5 --retry-delay 2 --retry-all-errors \
            --connect-timeout 30 --max-time 300 \
            -o "${idx}" \
            "${pool_host}/dists/${suite}/${component}/binary-${arch}/Packages.gz"; then
            found="$(python3 - "${idx}" "${pkg}" <<'PY'
import gzip, sys
from pathlib import Path
data = gzip.decompress(Path(sys.argv[1]).read_bytes()).decode("utf-8", errors="replace")
pkg = sys.argv[2]
block = []
for line in data.splitlines():
    if line == "":
        name = next((l[9:] for l in block if l.startswith("Package: ")), None)
        if name == pkg:
            filename = next((l[10:] for l in block if l.startswith("Filename: ")), None)
            if filename:
                print(filename)
                break
        block = []
    else:
        block.append(line)
PY
)"
            rm -f "${idx}"
            [[ -n "${found}" ]] && break
          else
            rm -f "${idx}"
            echo "  warn: failed Packages.gz ${suite}/${component}/${arch}" >&2
          fi
        done
      fi

      if [[ -z "${found}" ]]; then
        echo "error: package ${pkg} not found in ${suite}/${arch}" >&2
        exit 1
      fi
      local deb_url="${pool_host}/${found}"
      local out="${dest}/${suite}/$(basename "${found}")"
      download "${deb_url}" "${out}"
    done
  done
}

# Shared (arch-independent) notes file for cache.
mkdir -p "${CACHE}"
cat > "${CACHE}/README.txt" <<EOF
Frozen cache for ha-cluster payloads.
K3S_VERSION=${K3S_VERSION}
EASYTIER_VERSION=${EASYTIER_VERSION}
UBUNTU_CLOUD=${UBUNTU_CLOUD_SERIES} (${UBUNTU_CLOUD_CODENAME})
DEB_SUITES=${DEB_SUITES}
Fetched by packaging/fetch-deps.sh — do not commit large binaries.
EOF

case "${ARCH_ARG}" in
  amd64 | arm64)
    fetch_arch "${ARCH_ARG}"
    ;;
  all)
    fetch_arch amd64
    fetch_arch arm64
    ;;
  *)
    echo "usage: $0 [amd64|arm64|all]" >&2
    exit 2
    ;;
esac

echo "OK: cache ready under ${CACHE}"
