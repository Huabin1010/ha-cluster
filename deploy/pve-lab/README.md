# PVE 局域网测试实验室

三台 VM（`ha-test-01/02/03`）模拟生产 Worker，对接开发机控制面与 EasyTier Fabric。

## 前置

| 项 | 说明 |
|----|------|
| PVE | `ssh root@192.168.1.8`，VM 110–112 运行中 |
| 控制面 | `docker/dev` 或 `go run ./cmd/ha-api`，`HA_NODE_TOKEN` 与 `lab.env` 一致 |
| 密钥 | `lab.env` 中 `HA_ET_SECRET` 与 Hub 相同（`docs/credentials.local.md`） |
| 网络 | VM 能访问开发机 `STAGING_HOST:STAGING_PORT` 与 `HA_API_BASE` |

## 快速开始

```powershell
# 1. 本地控制面
powershell -File docker/dev/up.ps1

# 2. 配置 lab.env
copy deploy\pve-lab\lab.env.example deploy\pve-lab\lab.env

# 3. 发布离线包（仅改代码后需要，~7s）
python deploy/pve-lab/pack.py
python deploy/pve-lab/upload.py

# 4. 一键安装三台 Worker（~10–15s，含 reset）
python deploy/pve-lab/bootstrap.py

# 5. 用真机 agent 替换 mock-agents
powershell -File deploy/pve-lab/use-pve-workers.ps1
```

**耗时参考**（局域网）：同步 PVE 镜像 ~2s，单台安装 ~3s，三台合计 **~12s**。  
`bootstrap.py` 默认走 PVE `192.168.1.8:19090`（快）；`--depot-only` 走公网 CDN（慢，用于验证发布）。

**不要**把 `pack + upload + bootstrap` 绑在一次命令里——发布与安装分开，日常只跑 `bootstrap.py`。

## 节点与 Fabric IP

| VMID | 名称 | Fabric IP |
|------|------|-----------|
| 110 | ha-test-01 | `10.129.129.205` |
| 111 | ha-test-02 | `10.129.129.206` |
| 112 | ha-test-03 | `10.129.129.207` |

| 名称 | 当前 LAN IP（DHCP，以 `nodes.json` 为准） |
|------|------------------------------------------|
| ha-test-01 | `192.168.1.82` |
| ha-test-02 | `192.168.1.80` |
| ha-test-03 | `192.168.1.83` |

`bootstrap.py` 会通过 PVE guest agent 探测并写回 `nodes.json`。

## EasyTier（Hub 通后）

1. 在 `lab.env` 填写 `HA_ET_SECRET`，设 `SKIP_EASYTIER=0`
2. 重新 `upload-staging.ps1` 或 `bootstrap.py`
3. 每台 VM：

```bash
ssh root@192.168.1.8 "qm guest exec 110 -- bash -lc \\
  'export STAGING=http://192.168.1.8:19090 NODE_NAME=ha-test-01 FABRIC_IP=10.129.129.205; \\
   curl -fsSL \$STAGING/install-easytier.sh | bash'"
```

验收：`ping 10.129.129.1`（在 VM 内）。

## Incus（Workspace 真起容器）

默认 `SKIP_INCUS=1` 加快首轮安装。需要真起 Workspace 时：

```bash
ssh root@192.168.1.8 "qm guest exec 110 -- bash -lc \\
  'export NODE_NAME=ha-test-01; curl -fsSL http://192.168.1.8:19090/install-incus.sh | bash'"
```

每台执行一次（apt 较慢，约 5–10 分钟）。

## 验收

```bash
# API 应看到三台节点
curl -s http://192.168.1.100:8080/healthz

HA_API_BASE=http://192.168.1.100:8080 HA_EXPECT_NODES=ha-test-01,ha-test-02,ha-test-03 \
  python docker/dev/integration-test.py

# 控制台：Nodes Ready → 创建 Workspace → running
```

## 仅更新 agent

```bash
GOOS=linux GOARCH=amd64 go build -o dist/ha-agent-linux-amd64 ./cmd/ha-agent
# 然后重新 bootstrap，或单台 qm guest exec 替换 /usr/local/bin/ha-agent
```

## 注意

- **不要**改 PVE 宿主机 hostname。
- Hub 未通时 `ping 10.129.129.1` 会失败，但 agent 心跳仍可走 LAN API。
- 需要更大 VM：SSH 到 `192.168.1.8` 上 `qm clone` 模板 100（见 `.cursor/rules/pve-test-lab.mdc`）。
