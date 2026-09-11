#!/usr/bin/env bash
# Workspace 容器内 docker.io 离线 deb（Ubuntu 24.04 noble），打进 incus-offline bundle。
# Usage: bash packaging/fetch-workspace-docker.sh [amd64]
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-amd64}"
OUT="${ROOT}/packaging/cache/${ARCH}/workspace-debs"
mkdir -p "${OUT}"

if compgen -G "${OUT}/*.deb" >/dev/null && [[ "$(find "${OUT}" -name '*.deb' | wc -l)" -gt 3 ]]; then
  echo "skip: workspace docker debs already in ${OUT}"
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

echo "==> fetch docker.io debs (noble/${DARCH}) → ${OUT}"
rm -f "${OUT}"/*.deb

docker run --rm \
  -v "${OUT}:/out" \
  "ubuntu:24.04" \
  bash -euxo pipefail -c "
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates apt-utils
    cd /out
    apt-get install -y -qq --download-only docker.io
    cp -a /var/cache/apt/archives/*.deb /out/
    ls -la /out/
  "

count="$(find "${OUT}" -name '*.deb' | wc -l)"
if [[ "${count}" -lt 3 ]]; then
  echo "error: expected multiple docker debs, got ${count}" >&2
  exit 1
fi
echo "OK: ${count} workspace docker debs in ${OUT}"
