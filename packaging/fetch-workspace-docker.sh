#!/usr/bin/env bash
# Workspace 容器内 docker.io + fuse-overlayfs 离线 deb（Ubuntu 24.04 noble）。
# fuse-overlayfs 给嵌套 Docker 做层共享（内核 overlay 不认 Incus idmapped 根盘）。
# Usage: bash packaging/fetch-workspace-docker.sh [amd64]
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-amd64}"
OUT="${ROOT}/packaging/cache/${ARCH}/workspace-debs"
mkdir -p "${OUT}"

if compgen -G "${OUT}/docker.io_*.deb" >/dev/null \
  && compgen -G "${OUT}/fuse-overlayfs_*.deb" >/dev/null \
  && [[ "$(find "${OUT}" -name '*.deb' | wc -l)" -gt 4 ]]; then
  echo "skip: workspace docker + fuse-overlayfs debs already in ${OUT}"
  exit 0
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing command: $1" >&2
    exit 1
  }
}
need_cmd docker

case "${ARCH}" in
  amd64) DARCH="amd64" ;;
  arm64) DARCH="arm64" ;;
  *) echo "unsupported arch: ${ARCH}" >&2; exit 2 ;;
esac

echo "==> fetch docker.io + fuse-overlayfs debs (noble/${DARCH}) → ${OUT}"
rm -f "${OUT}"/*.deb

docker run --rm \
  -v "${OUT}:/out" \
  "ubuntu:24.04" \
  bash -euxo pipefail -c "
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates apt-utils
    cd /out
    apt-get install -y -qq --download-only docker.io fuse-overlayfs fuse3
    cp -a /var/cache/apt/archives/*.deb /out/
    ls -la /out/
  "

count="$(find "${OUT}" -name '*.deb' | wc -l)"
if [[ "${count}" -lt 4 ]]; then
  echo "error: expected docker + fuse debs, got ${count}" >&2
  exit 1
fi
if ! compgen -G "${OUT}/fuse-overlayfs_*.deb" >/dev/null; then
  echo "error: fuse-overlayfs deb missing in ${OUT}" >&2
  exit 1
fi
echo "OK: ${count} workspace docker/fuse debs in ${OUT}"
