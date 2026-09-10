# 一键准备 PVE 测试 Worker（EasyTier + ha-agent + Incus）
$ErrorActionPreference = "Stop"
$LabDir = $PSScriptRoot
$EnvFile = Join-Path $LabDir "lab.env"

if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $LabDir "lab.env.example") $EnvFile
    Write-Host ">>> 已创建 lab.env — 请编辑 HA_ET_SECRET 后重新运行" -ForegroundColor Yellow
    exit 1
}

$secret = (Select-String -Path $EnvFile -Pattern '^HA_ET_SECRET=').Line
if ($secret -match 'replace-with-hub-secret') {
    Write-Host ">>> 请在 deploy/pve-lab/lab.env 中设置 HA_ET_SECRET（Hub 网络密钥）" -ForegroundColor Yellow
    exit 1
}

python (Join-Path $LabDir "bootstrap.py")
