# 按 offline-depot 规则：拉取依赖 → 打包 → 上传 RustFS Depot
# 凭证勿提交；见 docs/credentials.local.md 或本机环境变量
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

Write-Host "==> 1/4 fetch-deps (amd64) — 需外网，仅维护者执行一次"
bash -lc "cd '$Root' && bash packaging/fetch-deps.sh amd64"

Write-Host "==> 2/4 pack main payload (amd64)"
bash -lc "cd '$Root' && bash packaging/pack.sh amd64"

Write-Host "==> 3/4 pack pve-lab (incus-offline bundle + agent)"
python (Join-Path $Root "deploy\pve-lab\pack.py")

Write-Host "==> 4/4 upload Depot"
foreach ($v in @("HA_DEPOT_S3_ENDPOINT", "HA_DEPOT_S3_BUCKET", "HA_DEPOT_S3_ACCESS_KEY", "HA_DEPOT_S3_SECRET_KEY")) {
    if (-not (Get-Item "Env:$v" -ErrorAction SilentlyContinue)) {
        Write-Error "set $v before upload (see docs/credentials.local.md)"
    }
}
python (Join-Path $Root "packaging\upload-depot-s3.py")
python (Join-Path $Root "deploy\pve-lab\upload.py")

Write-Host "`nDone."
Write-Host "  LAN:  http://192.168.1.9:10000/typora/ha-cluster"
Write-Host "  公网: https://rustfs.s.ggss.club:50000/typora/ha-cluster"
