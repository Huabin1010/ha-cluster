# 启动本地 Docker 开发栈（Postgres + API + Web + mock agents）
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DevDir = $PSScriptRoot

if (-not (Test-Path "$DevDir\.env")) {
    Copy-Item "$DevDir\.env.example" "$DevDir\.env"
    Write-Host ">>> 已创建 docker/dev/.env（默认值）"
}

Set-Location $DevDir
docker compose up -d @args

Write-Host ""
Write-Host ">>> 控制台: http://localhost:5173"
Write-Host ">>> API:    http://localhost:8080/healthz"
Write-Host ">>> Admin:  admin / 123456qq"
Write-Host ">>> Adminer: http://localhost:8081  (postgres / ha / ha / ha)"
Write-Host ""
Write-Host ">>> 跑集成测试: docker compose --profile test run --rm test-integration"
Write-Host ">>> 跑流程测试: docker compose --profile test run --rm test-workflow"
