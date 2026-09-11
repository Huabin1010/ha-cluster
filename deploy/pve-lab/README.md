# PVE 局域网测试实验室

三台 VM（`ha-test-jammy` / `ha-test-noble` / `ha-test-resolute`）覆盖 Ubuntu 22.04 / 24.04 / 26.04，对接控制面与 EasyTier Fabric。

## 架构

| 角色 | 地址 | 说明 |
|------|------|------|
| PVE 宿主机 | `192.168.1.8` | **仅**跑 VM；禁止在上面部署 Depot / HTTP 镜像 |
| RustFS（局域网） | `http://192.168.1.9:10000` | 与公网 `rustfs.s.ggss.club:50000` 同 bucket/键 |
| Depot 根（lab） | `http://192.168.1.9:10000/typora/ha-cluster` | VM 从此拉 500MB bundle，局域网很快 |
| 控制面（专用 VM） | `http://192.168.1.60:8080` | PVE VM **113** `ha-control-lab`（`deploy-control.ps1`） |
| 控制面（本机 dev） | `http://192.168.1.100:8080` | `docker/dev` 或 `go run ./cmd/ha-api` |

## 专用控制面 VM（推荐实验室）

在 PVE 上**新建** VM 113，不占用现有业务机（如 `.66` shuangyuan）：

```powershell
# 打包 + 创建 VM + 部署 API/Postgres + EasyTier Hub
powershell -File deploy/pve-lab/deploy-control.ps1

# 仅重新部署（VM 已存在）
powershell -File deploy/pve-lab/deploy-control.ps1 -SkipProvision
```

| VMID | 名称 | LAN IP（DHCP） | Fabric Hub |
|------|------|----------------|------------|
| 113 | ha-control-lab | `192.168.1.60` | `10.129.129.1` |

## 快速开始

```powershell
# 1. 本地控制面（可选，与 VM 113 二选一）
powershell -File docker/dev/up.ps1

# 2. 配置 lab.env（DEPOT_PUBLIC 默认已指向局域网 RustFS）
copy deploy\pve-lab\lab.env.example deploy\pve-lab\lab.env

# 3. PVE 上创建三套 Ubuntu 测试 VM
#    cloud 磁盘镜像：Canonical cloud-images.ubuntu.com → 机械盘 data-backup
#    VM 磁盘 / 镜像缓存：PVE storage `data-backup`（/mnt/pve/data-backup，sdb 1.8T）
#    VM 内 apt：清华源 mirrors.tuna.tsinghua.edu.cn/ubuntu
#    110=22.04 jammy  111=24.04 noble  112=26.04 resolute
python deploy/pve-lab/provision-os-vms.py

# Incus 容器启动烟测（三台）
python deploy/pve-lab/test-incus-launch.py

# 4. 发布离线包（Incus 三版本 debs + workspace 镜像）
bash packaging/fetch-incus.sh amd64 all   # 维护机 Docker
python deploy/pve-lab/pack.py
$env:HA_DEPOT_S3_ENDPOINT='http://192.168.1.9:10000'
python deploy/pve-lab/upload.py

# 5. 三台并行安装（离线 Incus + 清华 apt）
#    lab.env: HA_INSTALL_MODE=offline  HA_APT_MIRROR=tuna  SKIP_INCUS=0
python deploy/pve-lab/test-all-os.py
# 或单台：python deploy/pve-lab/test-all-os.py --only jammy

# 兼容旧流程
python deploy/pve-lab/bootstrap.py

# 5. 用真机 agent 替换 mock-agents
powershell -File deploy/pve-lab/use-pve-workers.ps1
```

**耗时参考**（局域网 RustFS）：单台安装 ~20–60s（含 Incus 时更长），下载 500MB bundle 通常数秒。  
慢的是 **现场 bake docker 进镜像**（每台一次），不是下载。

**不要**把 `pack + upload + bootstrap` 绑在一次命令里——发布与安装分开，日常只跑 `bootstrap.py`。

## 节点与 Fabric IP

| VMID | 名称 | Ubuntu | Fabric IP |
|------|------|--------|-----------|
| 110 | ha-test-jammy | 22.04 | `10.129.129.205` |
| 111 | ha-test-noble | 24.04 | `10.129.129.206` |
| 112 | ha-test-resolute | 26.04 | `10.129.129.207` |

| 名称 | 当前 LAN IP（DHCP，以 `nodes.json` 为准） |
|------|------------------------------------------|
| ha-test-01 | `192.168.1.82` |
| ha-test-02 | `192.168.1.80` |
| ha-test-03 | `192.168.1.83` |

## EasyTier（Hub 通后）

1. 在 `lab.env` 填写 `HA_ET_SECRET`，设 `SKIP_EASYTIER=0`
2. 重新 `bootstrap.py`

## Incus（Workspace 真起容器）

默认 `SKIP_INCUS=1` 加快首轮安装。需要真起 Workspace 时设 `SKIP_INCUS=0` 后重新 bootstrap。

**安装模式**（`HA_INSTALL_MODE`，默认 `auto`）：

| 模式 | 行为 |
|------|------|
| `auto` | `HA_APT_MIRROR=tuna` 时强制 **offline**（外网组件走 Depot）；否则能连 Zabbly 则在线 |
| `online` | 强制在线（宝塔式，依赖由 apt 解析，适配本机补丁级别） |
| `offline` | Depot `bundles/amd64/incus-offline.tar.zst`（含 `debs/jammy|noble|resolute/`） |

实验室默认：`HA_INSTALL_MODE=offline` + `HA_APT_MIRROR=tuna` + `HA_VERIFY_EGRESS=0`（跳过容器 ping 8.8.8.8）。

在线路径只从 S3 拉 workspace 底镜像（`bundles/<arch>/images/ubuntu-24.04-...`），docker 在容器内 `apt install docker.io`。

单台：

```bash
DEPOT=http://192.168.1.9:10000/typora/ha-cluster
ssh root@192.168.1.8 "qm guest exec 110 -- bash -lc \\
  'export STAGING=${DEPOT} DEPOT_PUBLIC=${DEPOT} NODE_NAME=ha-test-01 HA_INSTALL_MODE=auto; \\
   curl -fsSL \${DEPOT}/lab/install-incus.sh | bash'"
```

## 验收

```bash
curl -s http://192.168.1.100:8080/healthz

HA_API_BASE=http://192.168.1.100:8080 HA_EXPECT_NODES=ha-test-01,ha-test-02,ha-test-03 \
  python docker/dev/integration-test.py
```

## 注意

- **不要**在 PVE 宿主机上跑 `python -m http.server` 或临时 staging——用局域网 RustFS。
- **不要**改 PVE 宿主机 hostname。
- 公网验证发布：`bootstrap.py --use-public`（慢，仅维护者偶尔用）。
