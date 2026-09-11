#!/usr/bin/env bash
set -euo pipefail
DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEV_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo ">>> 已创建 docker/dev/.env（默认值）"
fi

docker compose up -d "$@"

cat <<'EOF'

>>> 控制台: http://localhost:5173
>>> API:    http://localhost:8080/healthz
>>> Admin:  admin / 123456qq
>>> Adminer: http://localhost:8081  (System=postgres, User=ha, Password=ha, Database=ha)

>>> 跑集成测试: docker compose --profile test run --rm test-integration
>>> 跑流程测试: docker compose --profile test run --rm test-workflow
EOF
