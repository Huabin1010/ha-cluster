# 上传制品到 PVE 并启动临时 HTTP 服务
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Staging = Join-Path $Root "dist\pve-lab-staging"
$Lab = $PSScriptRoot

if (-not (Test-Path (Join-Path $Lab "lab.env"))) {
    Copy-Item (Join-Path $Lab "lab.env.example") (Join-Path $Lab "lab.env")
    throw "请先编辑 deploy/pve-lab/lab.env"
}

New-Item -ItemType Directory -Force -Path $Staging | Out-Null
$env:GOOS = "linux"; $env:GOARCH = "amd64"; $env:CGO_ENABLED = "0"
Push-Location $Root
go build -o (Join-Path $Staging "ha-agent-linux-amd64") ./cmd/ha-agent
Pop-Location

$copyScripts = @("worker-install.sh", "install-easytier.sh", "install-incus.sh", "lab.env")
foreach ($f in $copyScripts) {
    $text = [IO.File]::ReadAllText((Join-Path $Lab $f)).Replace("`r`n", "`n")
    [IO.File]::WriteAllText((Join-Path $Staging $f), $text)
}
Copy-Item (Join-Path $Root "deploy\easytier.service") (Join-Path $Staging "easytier.service")
$et = [IO.File]::ReadAllText((Join-Path $Root "deploy\easytier-start.sh")).Replace("`r`n", "`n")
[IO.File]::WriteAllText((Join-Path $Staging "easytier-start.sh"), $et)

$port = 19090
$files = @("worker-install.sh", "install-easytier.sh", "install-incus.sh", "lab.env", "easytier.service", "easytier-start.sh", "ha-agent-linux-amd64")
ssh -o BatchMode=yes root@192.168.1.8 "mkdir -p /tmp/ha-pve-lab-staging"
foreach ($f in $files) {
    $p = Join-Path $Staging $f
    if (Test-Path $p) { scp $p "root@192.168.1.8:/tmp/ha-pve-lab-staging/" }
}
ssh -o BatchMode=yes root@192.168.1.8 "sed -i 's/\r$//' /tmp/ha-pve-lab-staging/*.sh /tmp/ha-pve-lab-staging/lab.env 2>/dev/null; fuser -k ${port}/tcp 2>/dev/null || true; cd /tmp/ha-pve-lab-staging && nohup python3 -m http.server $port --bind 0.0.0.0 >/tmp/ha-staging-http.log 2>&1 </dev/null &"
Write-Host ">>> staging: http://192.168.1.8:$port"
