#!/usr/bin/env bash
# Serve dist/ as Depot on 127.0.0.1:9090 (never 0.0.0.0 / never 80/443).
# Usage: bash packaging/depot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${ROOT}/dist"
BIND="${HA_DEPOT_BIND:-127.0.0.1}"
PORT="${HA_DEPOT_PORT:-9090}"

if [[ ! -d "${DIST}/payload-linux-amd64" && ! -d "${DIST}/payload-linux-arm64" ]]; then
  echo "error: no payload under ${DIST}; run packaging/pack.sh first" >&2
  exit 1
fi

cd "${DIST}"
echo "Depot: http://${BIND}:${PORT}/"
echo "  e.g. curl -fsS http://${BIND}:${PORT}/payload-linux-amd64/manifest.json"
echo "Bind is loopback/overlay only — do not publish on public 80/443 (T1)."
exec python3 -m http.server "${PORT}" --bind "${BIND}"
