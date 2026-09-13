# 在 42 上执行 rolling-up.sh（本机只负责 scp + ssh）
$ErrorActionPreference = "Stop"
$HostName = if ($env:HA_PROD_HOST) { $env:HA_PROD_HOST } else { "root@42.193.236.123" }
$RemoteDir = if ($env:HA_DEPLOY_DIR) { $env:HA_DEPLOY_DIR } else { "/www/wwwroot/cl.qzsyzn.com/docker" }
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

scp -o BatchMode=yes "$Root/rolling-up.sh" "${HostName}:${RemoteDir}/rolling-up.sh"
scp -o BatchMode=yes "$Root/rolling_check.py" "${HostName}:${RemoteDir}/rolling_check.py"
ssh -o BatchMode=yes $HostName "sed -i 's/\r$//' '${RemoteDir}/rolling-up.sh' '${RemoteDir}/rolling_check.py'; chmod +x '${RemoteDir}/rolling-up.sh'; cd '${RemoteDir}'; bash ./rolling-up.sh"
