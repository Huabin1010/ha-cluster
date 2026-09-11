# 在 PVE 新建专用控制面 VM（113）并部署 ha-cluster + EasyTier Hub
# 用法: powershell -File deploy/pve-lab/deploy-control.ps1
#       powershell -File deploy/pve-lab/deploy-control.ps1 -SkipProvision

param(
    [switch]$SkipProvision
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Pve = if ($env:PVE_HOST) { $env:PVE_HOST } else { "192.168.1.8" }
$StatusFile = Join-Path $PSScriptRoot "control-vm.status.json"
$RemoteTar = "/tmp/ha-cluster-stack.tar.gz"
$Vmid = 113

Set-Location $Root

if (-not $SkipProvision) {
    Write-Host "==> provision control VM $Vmid on PVE $Pve"
    python deploy/pve-lab/provision-control-vm.py
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path $StatusFile)) {
    throw "missing $StatusFile — run provision first"
}
$meta = Get-Content $StatusFile | ConvertFrom-Json
$LanIp = $meta.lan_ip
Write-Host "==> control VM LAN: $LanIp"

Write-Host "==> pack stack"
python deploy/pve-lab/ship-stack.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Archive = Join-Path $Root "dist\ha-cluster-stack.tar.gz"
Write-Host "==> upload tarball to PVE $Pve"
scp -o BatchMode=yes $Archive "root@${Pve}:$RemoteTar"

scp -o BatchMode=yes (Join-Path $PSScriptRoot "stack\deploy-on-pve.sh") "root@${Pve}:/tmp/deploy-on-pve.sh"
Write-Host "==> deploy stack + easytier hub on VM $Vmid"
ssh -o BatchMode=yes "root@$Pve" "chmod +x /tmp/deploy-on-pve.sh; LAN_IP=$LanIp bash /tmp/deploy-on-pve.sh"

$secret = ssh -o BatchMode=yes "root@$Pve" "qm guest exec $Vmid --timeout 30 -- grep HA_ET_SECRET /etc/ha-cluster/easytier-ha.env 2>/dev/null" | Select-String -Pattern '[0-9a-f]{32}' | ForEach-Object { $_.Matches.Value }

Write-Host ""
Write-Host "==> 部署完成"
Write-Host "  控制台/API: http://${LanIp}:8080"
Write-Host "  EasyTier Hub: ${LanIp}:15010 (fabric 10.129.129.1)"
Write-Host "  ET Secret:    $secret"
Write-Host ""
Write-Host "更新 deploy/pve-lab/lab.env:"
Write-Host "  HA_API_BASE=http://${LanIp}:8080"
Write-Host "  HA_ET_PEERS=udp://${LanIp}:15010 tcp://${LanIp}:15010"
Write-Host "  HA_ET_SECRET=$secret"
Write-Host "  SKIP_EASYTIER=0"
Write-Host ""
Write-Host "然后: python deploy/pve-lab/bootstrap.py"
