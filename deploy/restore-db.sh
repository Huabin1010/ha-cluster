#!/usr/bin/env bash
# Restore ha-cluster PostgreSQL from a backup archive.
# Usage: DATABASE_URL=postgres://... ./restore-db.sh /path/to/ha-20260101T000000Z.sql.gz
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <backup-file.sql.gz|.sql.gz.enc>" >&2
  exit 2
fi

INPUT="$1"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

TMP="$(mktemp)"
cleanup() { rm -f "${TMP}"; }
trap cleanup EXIT

if [[ "${INPUT}" == *.enc ]]; then
  if [[ -z "${HA_BACKUP_ENCRYPT_PASS:-}" ]]; then
    echo "HA_BACKUP_ENCRYPT_PASS required for encrypted backup" >&2
    exit 1
  fi
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:${HA_BACKUP_ENCRYPT_PASS}" -in "${INPUT}" | gunzip > "${TMP}"
else
  gunzip -c "${INPUT}" > "${TMP}"
fi

echo "[restore] applying ${INPUT} to ${DATABASE_URL%%@*}@..."
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${TMP}"
echo "[restore] done"
