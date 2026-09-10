# 切换 Docker 控制面到 PVE 真机 agent（停 mock-agents，API 走 RemoteAgent）
$ErrorActionPreference = "Stop"
$DevDir = Resolve-Path (Join-Path $PSScriptRoot "..\..\docker\dev")
Push-Location $DevDir
docker compose stop mock-agents
$envPath = Join-Path $DevDir ".env"
$content = Get-Content $envPath -Raw
if ($content -notmatch "HA_RUNTIME=remote") {
    $content = $content -replace "HA_RUNTIME=memory", "HA_RUNTIME=remote"
    Set-Content -Path $envPath -Value $content -NoNewline
    docker compose up -d api
}
Pop-Location
Write-Host ">>> mock-agents 已停；API HA_RUNTIME=remote"
Write-Host ">>> 验证: HA_API_BASE=http://127.0.0.1:8080 python docker/dev/integration-test.py"
