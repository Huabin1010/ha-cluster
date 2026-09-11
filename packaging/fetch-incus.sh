#!/usr/bin/env bash
# Download Zabbly Incus debs for multiple Ubuntu suites into
#   packaging/cache/<arch>/incus/<suite>/debs/
# Maintainer-only; workers install from Depot offline bundle.
#
# Usage:
#   bash packaging/fetch-incus.sh [amd64] [jammy|noble|resolute|all]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=versions.env
source "${ROOT}/packaging/versions.env"

ARCH="${1:-amd64}"
SUITE_ARG="${2:-all}"

case "${ARCH}" in
  amd64) ZABBLY_ARCH="amd64" ;;
  arm64) ZABBLY_ARCH="arm64" ;;
  *)
    echo "error: incus offline debs only built for amd64/arm64; got ${ARCH}" >&2
    exit 2
    ;;
esac

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing command: $1" >&2
    exit 1
  }
}
need_cmd docker

fetch_suite() {
  local suite="$1"
  local out="${ROOT}/packaging/cache/${ARCH}/incus/${suite}/debs"
  mkdir -p "${out}"

  if compgen -G "${out}/*.deb" >/dev/null && [[ "$(find "${out}" -name '*.deb' | wc -l)" -gt 5 ]]; then
    echo "skip: incus debs already in ${out}"
    return 0
  fi

  local image="ubuntu:${suite#jammy/}"
  case "${suite}" in
    jammy) image="ubuntu:22.04" ;;
    noble) image="ubuntu:24.04" ;;
    resolute) image="ubuntu:26.04" ;;
    *)
      echo "error: unsupported suite ${suite}" >&2
      return 2
      ;;
  esac

  echo "==> fetch incus debs (${suite}/${ZABBLY_ARCH}) via ${image} → ${out}"
  rm -f "${out}"/*.deb

  local inner="${ROOT}/packaging/docker-fetch-incus-inner.sh"
  docker run --rm \
    -v "${out}:/out" \
    -v "${inner}:/fetch-incus-inner.sh:ro" \
    "${image}" \
    bash /fetch-incus-inner.sh "${suite}" "${ZABBLY_ARCH}" /out

  local count
  count="$(find "${out}" -maxdepth 1 -name '*.deb' | wc -l)"
  if [[ "${count}" -lt 3 ]]; then
    echo "error: expected multiple .deb files for ${suite}, got ${count}" >&2
    return 1
  fi

  # 记录冻结信息，供 pack / 排障
  cat >"${ROOT}/packaging/cache/${ARCH}/incus/${suite}/MANIFEST.txt" <<EOF
suite=${suite}
arch=${ARCH}
channel=incus/stable
fetched=$(date -u +%Y-%m-%dT%H:%MZ)
deb_count=${count}
EOF
  echo "OK: ${count} incus debs in ${out}"
}

SUITES=()
case "${SUITE_ARG}" in
  all)
    # shellcheck disable=SC2206
    SUITES=(${INCUS_ZABBLY_SUITES:-jammy noble resolute})
    ;;
  jammy | noble | resolute)
    SUITES=("${SUITE_ARG}")
    ;;
  *)
    echo "usage: $0 [amd64|arm64] [jammy|noble|resolute|all]" >&2
    exit 2
    ;;
esac

for suite in "${SUITES[@]}"; do
  fetch_suite "${suite}"
done
