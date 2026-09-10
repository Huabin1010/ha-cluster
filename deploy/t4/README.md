# T4 · Worker 运行时 / 一键包

> 验收路径：**A**（dev-pc 同机 `ha-api` + Incus）  
> 规划 phone worker：**ginkgo**（arm64）  
> 日期：2026-09-06

## 书面选择

| 项 | 值 |
|----|-----|
| 验收路径 | **A** |
| Path A 验证机 | `dev-pc` 或 PVE `ha-test-01`（amd64 / `10.129.129.205`） |
| 规划下一台 phone | `ginkgo`（开机后 scp arm64 包） |

---

## 完整 worker 一键包（推荐）

在开发机构建（**不重写 T3 `packaging/pack.sh`**；可选用 `packaging/cache/`）：

```bash
export SUDO_PASSWORD='…'   # 可选，给 Incus export 用
bash deploy/t4/build-worker-bundle.sh amd64
bash deploy/t4/build-worker-bundle.sh arm64
```

产物（不进 Git，在 `dist/`）：

| 文件 | 用途 |
|------|------|
| `dist/worker-bundle-linux-<arch>/` | 解压后的目录 |
| `dist/ha-worker-bundle-linux-<arch>.tar.zst` | **scp 用** 压缩包 |
| 内含 | `ha-agent` `ha-setup` `install.sh`、`easytier-core`、`k3s`+airgap、Workspace 镜像、`manifest.json`+`SHA256SUMS` |

镜像策略：

1. **同 arch 构建机**：`docker save ubuntu:24.04` → `images/ubuntu-24.04.docker.tar`（可 scp；安装时 docker load → export → Incus）
2. **同 arch + 本机已有 Incus 镜像**：`incus image export` → `images/ha-ubuntu-24.04` + `.root`（优先）
3. **跨 arch（本机打 arm64）**：本环境 docker multi-arch 不可靠，**用 `packaging/cache` 的 cloud rootfs**（`ubuntu-*-root.tar.xz`）导入 Incus

### 传到目标机（确定性）

```bash
# 例：开发机 → ginkgo（LAN 或 NPS）
scp dist/ha-worker-bundle-linux-arm64.tar.zst root@192.168.1.124:/tmp/
# 或：scp -P 8089 dist/ha-worker-bundle-linux-arm64.tar.zst root@106.52.109.127:/tmp/

ssh root@… 'mkdir -p /var/cache && cd /var/cache && tar -I zstd -xf /tmp/ha-worker-bundle-linux-arm64.tar.zst'
```

### 一键安装

```bash
cd /var/cache/worker-bundle-linux-arm64
./install.sh \
  --token 'ha://join/prod/<secret>?et_net=ha-cluster-easytier&et_peer=tcp://110.40.229.62:15010&api=https://ha.mnnumath.vip/api&depot_public=https://rustfs.s.ggss.club:50000/typora/ha-cluster' \
  --fabric-ip 10.129.129.10 \
  --power battery \
  --class phone \
  --name ginkgo
# LAN 调试可加：--skip-easytier --skip-k3s --api-override http://192.168.1.148:8080
# k3s agent 需要：export K3S_TOKEN=$(ssh vps cat /var/lib/rancher/k3s/server/node-token)
```

安装脚本会：校验 arch + 关键 checksum → 装二进制 → 导入 Incus 镜像别名 `ha-ubuntu-24.04` → `ha-setup join` → systemd `ha-agent`（可选 EasyTier / k3s-agent）。

### 本机已验证（amd64）

```text
sudo bash dist/worker-bundle-linux-amd64/install.sh \
  --token 'ha://join/c1/local?et_net=ha-c1&…&api=http://127.0.0.1:8080' \
  --fabric-ip 10.129.129.205 --name ha-test-01 --power mains --class desktop \
  --skip-easytier --skip-k3s --api-override http://127.0.0.1:8080
# → ha-agent active；incus alias ha-ubuntu-24.04；心跳 ready=true
```

---

## Path A（API 起容器）

```bash
export SUDO_PASSWORD='…'
export HA_INCUS_IMAGE=ha-ubuntu-24.04   # 一键包装完后用本地别名
bash deploy/t4/path-a-devpc.sh all
```

---

## VPS k3s server（属 T4，需 T2 `10.129.129.1`）

```bash
sudo bash deploy/t4/install-k3s-server.sh /var/cache/ha-payload-amd64   # 或 worker-bundle 内 k3s/
# 6443 不对公网
```

---

## 依赖说明

| 依赖 | 状态 |
|------|------|
| worker-bundle | **已打出** amd64 + arm64（`dist/`） |
| T2 EasyTier / `10.129.129.1` | k3s 正式联调需要；LAN Path A 可跳过 |
| ginkgo 在线 | 上电后 scp arm64 包即可 |
