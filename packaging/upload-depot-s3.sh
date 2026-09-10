#!/usr/bin/env bash
# 将 dist/ 与 install.sh 上传到 S3 兼容 Depot（RustFS / MinIO）。
# 凭据从环境变量或 docs/credentials.local.md 人工导出，禁止写进 Git。
#
# 用法：
#   source docs/credentials.local.md  # 或手动 export 下列变量
#   export HA_DEPOT_S3_ENDPOINT=https://rustfs.s.ggss.club:50000
#   export HA_DEPOT_S3_BUCKET=typora
#   export HA_DEPOT_S3_ACCESS_KEY=...
#   export HA_DEPOT_S3_SECRET_KEY=...
#   bash packaging/upload-depot-s3.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${ROOT}/dist"
PREFIX="${HA_DEPOT_S3_PREFIX:-ha-cluster}"

ENDPOINT="${HA_DEPOT_S3_ENDPOINT:?set HA_DEPOT_S3_ENDPOINT}"
BUCKET="${HA_DEPOT_S3_BUCKET:?set HA_DEPOT_S3_BUCKET}"
AK="${HA_DEPOT_S3_ACCESS_KEY:?set HA_DEPOT_S3_ACCESS_KEY}"
SK="${HA_DEPOT_S3_SECRET_KEY:?set HA_DEPOT_S3_SECRET_KEY}"

if [[ ! -d "${DIST}/payload-linux-amd64" && ! -f "${DIST}/ha-payload-linux-amd64.tar.zst" && ! -f "${ROOT}/packaging/install.sh" ]]; then
  echo "error: run packaging/pack.sh amd64 arm64 first, or keep packaging/install.sh" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "error: aws CLI required (aws s3 sync --endpoint-url ...)" >&2
  exit 1
fi

export AWS_ACCESS_KEY_ID="${AK}"
export AWS_SECRET_ACCESS_KEY="${SK}"
export AWS_DEFAULT_REGION="${HA_DEPOT_S3_REGION:-us-east-1}"

DEST="s3://${BUCKET}/${PREFIX}/"
echo "Uploading to ${ENDPOINT} ${DEST}"

aws s3 cp "${ROOT}/packaging/install.sh" "${DEST}install.sh" \
  --endpoint-url "${ENDPOINT}" --content-type "text/x-shellscript"

for arch in amd64 arm64; do
  if [[ -f "${DIST}/ha-setup-linux-${arch}" ]]; then
    aws s3 cp "${DIST}/ha-setup-linux-${arch}" "${DEST}ha-setup-linux-${arch}" \
      --endpoint-url "${ENDPOINT}"
  fi
  if [[ -f "${DIST}/ha-payload-linux-${arch}.tar.zst" ]]; then
    aws s3 cp "${DIST}/ha-payload-linux-${arch}.tar.zst" "${DEST}ha-payload-linux-${arch}.tar.zst" \
      --endpoint-url "${ENDPOINT}"
  fi
  if [[ -d "${DIST}/payload-linux-${arch}" ]]; then
    aws s3 sync "${DIST}/payload-linux-${arch}/" "${DEST}payload-linux-${arch}/" \
      --endpoint-url "${ENDPOINT}"
  fi
done

if [[ -f "${DIST}/VERSIONS.md" ]]; then
  aws s3 cp "${DIST}/VERSIONS.md" "${DEST}VERSIONS.md" --endpoint-url "${ENDPOINT}"
fi

PUBLIC="${HA_DEPOT_PUBLIC:-${ENDPOINT}/${BUCKET}/${PREFIX}}"
echo ""
echo "Done. Public base URL (path-style):"
echo "  ${PUBLIC}"
echo ""
echo "One-line join example:"
echo "  curl -fsSL ${PUBLIC}/install.sh | sudo bash -s join --token 'ha://join/...'"
