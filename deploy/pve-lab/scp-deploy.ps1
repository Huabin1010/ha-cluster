# 打包并 SCP 部署到 PVE 实验室
# 用法: powershell -File deploy/pve-lab/scp-deploy.ps1
# 环境变量可覆盖: $env:STACK_HOST=192.168.1.66  $env:HUB_HOST=192.168.1.8

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# 默认走专用控制面 VM（113）；勿部署到 shuangyuan 等业务机
$StatusFile = Join-Path $Root "tmp\pve-lab\control-vm.status.json"
$LegacyStatus = Join-Path $PSScriptRoot "control-vm.status.json"
if (-not (Test-Path $StatusFile) -and (Test-Path $LegacyStatus)) { $StatusFile = $LegacyStatus }
if ($env:STACK_HOST) {
  $StackHost = $env:STACK_HOST
} elseif (Test-Path $StatusFile) {
  $StackHost = (Get-Content $StatusFile | ConvertFrom-Json).lan_ip
} else {
  Write-Host "请先运行: powershell -File deploy/pve-lab/deploy-control.ps1" -ForegroundColor Yellow
  exit 1
}
$HubHost = if ($env:HUB_HOST) { $env:HUB_HOST } else { $StackHost }
$RemoteDir = "/opt/ha-cluster-stack"

Set-Location $Root

Write-Host "==> pack stack (docker build + tarball)"
python deploy/pve-lab/ship-stack.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Archive = Join-Path $Root "dist\ha-cluster-stack.tar.gz"
if (-not (Test-Path $Archive)) { throw "missing $Archive" }

Write-Host "==> scp to stack host $StackHost"
ssh -o BatchMode=yes "root@$StackHost" "mkdir -p $RemoteDir"
scp -o BatchMode=yes $Archive "root@${StackHost}:$RemoteDir/"

Write-Host "==> install control plane on $StackHost"
ssh -o BatchMode=yes "root@$StackHost" @"
set -e
cd $RemoteDir
tar xzf ha-cluster-stack.tar.gz
cd ha-cluster-stack
cp -n env.example stack.env 2>/dev/null || true
bash install-stack.sh
"@

Write-Host "==> scp hub bits to PVE host $HubHost"
ssh -o BatchMode=yes "root@$HubHost" "mkdir -p $RemoteDir"
scp -o BatchMode=yes `
  (Join-Path $Root "dist\ha-cluster-stack\easytier-core") `
  (Join-Path $Root "dist\ha-cluster-stack\easytier-start.sh") `
  (Join-Path $Root "deploy\pve-lab\stack\install-hub.sh") `
  (Join-Path $Root "deploy\pve-lab\stack\env.example") `
  "root@${HubHost}:$RemoteDir/"

Write-Host "==> install EasyTier hub on $HubHost"
ssh -o BatchMode=yes "root@$HubHost" @"
set -e
cd $RemoteDir
cp -n env.example stack.env 2>/dev/null || true
chmod +x install-hub.sh easytier-start.sh
bash install-hub.sh
"@

# 同步 secret 到 stack host stack.env
$secret = ssh -o BatchMode=yes "root@$HubHost" "grep '^HA_ET_SECRET=' /etc/ha-cluster/easytier-ha.env | cut -d= -f2-"
ssh -o BatchMode=yes "root@$StackHost" @"
grep -q '^HA_ET_SECRET=' $RemoteDir/stack.env 2>/dev/null || echo HA_ET_SECRET=$secret >> $RemoteDir/stack.env
"@

Write-Host "==> done"
Write-Host "  API:    http://${StackHost}:8080"
Write-Host "  Hub:    ${HubHost}:15010  fabric 10.129.129.1"
Write-Host "  Secret: $secret"
Write-Host ""
Write-Host "下一步: 更新 lab.env HA_API_BASE=http://${StackHost}:8080 并运行:"
Write-Host "  python deploy/pve-lab/bootstrap.py"
