# packaging · 离线 payload 与 Depot（T3）

本目录只负责 **打出可校验的 arch 包** 与 **本机 Depot**。不登录手机、不 `incus launch`、不改 OpenResty / sshd。

## 产物

| 路径 | 说明 |
|------|------|
| `dist/payload-linux-amd64/` | x86_64 完整 payload |
| `dist/payload-linux-arm64/` | aarch64 完整 payload |
| `dist/ha-payload-linux-*.tar.zst` | 同内容的 zstd 归档（体积对照） |
| `dist/VERSIONS.md` | 冻结版本与体积说明（T3 独占；可进 Git） |
| `packaging/cache/<arch>/` | 第三方下载缓存（不进 Git） |

每个 payload 含：`ha-agent` / `ha-setup`、`k3s` + airgap、`easytier-core`、Ubuntu 24.04 cloud rootfs、`debs/{jammy,resolute}/`、`manifest.json`、`SHA256SUMS`、`ARCH`。

## 一键构建（开发机，需联网）

```bash
# 1) 拉冻结第三方（k3s / EasyTier / Ubuntu rootfs / uidmap debs）
bash packaging/fetch-deps.sh all

# 2) 交叉编译 ha-* 并组装 payload
bash packaging/pack.sh amd64
bash packaging/pack.sh arm64
```

缺缓存文件时 `pack.sh` **非 0 退出**并打印缺什么（不会静默空包）。

改版本：编辑 [`versions.env`](versions.env)，再 `fetch-deps.sh` + `pack.sh`。

## Depot（:9090，仅本机 / overlay）

```bash
bash packaging/depot.sh
# 默认: http://127.0.0.1:9090/
# 若 EasyTier 已起且本机有 10.88.0.1：
#   HA_DEPOT_BIND=10.88.0.1 bash packaging/depot.sh
```

验收：

```bash
curl -fsS http://127.0.0.1:9090/payload-linux-amd64/manifest.json | head
curl -fsS http://127.0.0.1:9090/payload-linux-arm64/manifest.json | head
```

**禁止** 把 Depot 挂到 OpenResty 80/443（那是 T1）。

## 上传到公网 CDN（RustFS / bucket typora）

构建完成后：

```bash
# 凭据见 docs/credentials.local.md
bash packaging/upload-depot-s3.sh
```

目标机一键加节点：

```bash
curl -fsSL https://rustfs.s.ggss.club:50000/typora/ha-cluster/install.sh \
  | sudo bash -s join --token 'ha://join/...'
```

详见 [docs/implementation/28-depot-cdn-one-click-install.md](../docs/implementation/28-depot-cdn-one-click-install.md)。

## 给 T4 的使用约定

1. 只读拷贝 `dist/payload-linux-<arch>/`（或对应 `.tar.zst`）。
2. 安装前读 `manifest.json` 的 `arch` / 根目录 `ARCH`：与 `uname -m` 不一致则拒绝。
3. k3s：`INSTALL_K3S_SKIP_DOWNLOAD=true`，airgap 包进 `/var/lib/rancher/k3s/agent/images/`。
4. Incus 底包：`images/ubuntu-24.04-server-cloudimg-<arch>-root.tar.xz`（本任务不执行 import）。

## 体积

arm64 `.tar.zst` 目标 ≤ 800MiB；超限原因写在 `dist/VERSIONS.md`。
