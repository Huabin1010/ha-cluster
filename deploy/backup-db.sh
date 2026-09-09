#!/usr/bin/env bash
# PostgreSQL backup for ha-cluster control plane.
# Usage: source /etc/ha-cluster/api.env && ./backup-db.sh
set -euo pipefail

BACKUP_DIR="${HA_BACKUP_DIR:-/var/backups/ha-cluster}"
RETAIN_DAYS="${HA_BACKUP_RETAIN_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/ha-${TIMESTAMP}.sql.gz"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "[backup] dumping to ${ARCHIVE}"
pg_dump "${DATABASE_URL}" | gzip -9 > "${ARCHIVE}"

if [[ -n "${HA_BACKUP_ENCRYPT_PASS:-}" ]]; then
  enc="${ARCHIVE}.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:${HA_BACKUP_ENCRYPT_PASS}" -in "${ARCHIVE}" -out "${enc}"
  rm -f "${ARCHIVE}"
  ARCHIVE="${enc}"
  echo "[backup] encrypted -> ${ARCHIVE}"
fi

# Optional remote sync
if [[ -n "${HA_BACKUP_SCP_TARGET:-}" ]]; then
  echo "[backup] syncing to ${HA_BACKUP_SCP_TARGET}"
  scp -q "${ARCHIVE}" "${HA_BACKUP_SCP_TARGET}"
fi

if [[ -n "${HA_BACKUP_S3_ENDPOINT:-}" && -n "${HA_BACKUP_S3_BUCKET:-}" ]]; then
  if command -v aws >/dev/null 2>&1; then
    aws --endpoint-url "${HA_BACKUP_S3_ENDPOINT}" s3 cp "${ARCHIVE}" "s3://${HA_BACKUP_S3_BUCKET}/$(basename "${ARCHIVE}")"
    echo "[backup] uploaded to s3://${HA_BACKUP_S3_BUCKET}/$(basename "${ARCHIVE}")"
  else
    echo "[backup] aws CLI not found, skipping S3 upload" >&2
  fi
fi

find "${BACKUP_DIR}" -name 'ha-*' -type f -mtime +"${RETAIN_DAYS}" -delete 2>/dev/null || true
echo "[backup] done $(du -h "${ARCHIVE}" | cut -f1)"
