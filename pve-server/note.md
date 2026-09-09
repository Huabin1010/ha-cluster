# PVE 测试机

PVE 宿主机：`192.168.1.8`（节点名 `shuangyuan001`）  
模板 VM 100：`shuangyuan` / `123456qq`，Ubuntu + Docker

## ha-cluster 测试节点

| VMID | 名称 | IP | SSH |
|------|------|-----|-----|
| 110 | ha-test-01 | 192.168.1.84 | `ssh root@192.168.1.84` 或 `ssh shuangyuan@192.168.1.84` |
| 111 | ha-test-02 | 192.168.1.85 | `ssh root@192.168.1.85` |
| 112 | ha-test-03 | 192.168.1.87 | `ssh root@192.168.1.87` |

规格：4 核 / 4 GiB / 32 GiB 磁盘（`data-backup` 存储）

## 控制面联调

开发机 API：`http://192.168.1.100:8080`  
节点 Token：`ha-test-node-token-2026`（见 `tmp/integration-store.json` 会话）

每台 VM 已部署 `ha-agent` systemd 服务，15s 心跳注册到控制面。

```bash
# 本机启动控制面
HA_API_ADDR=:8080 HA_NODE_TOKEN=ha-test-node-token-2026 go run ./cmd/ha-api

# 部署/更新 agent
python pve-server/deploy-agents.py

# 注入 SSH 公钥 + 主机名
python pve-server/setup-test-vms.py

# API 全景集成测试
python pve-server/integration-test.py
```

## 注意

- **不要**把 PVE 宿主机 hostname 改成 `ha-test-01`，会导致 `qm` 找不到配置。
- PVE root 的 `authorized_keys` 在 `/etc/pve/priv/authorized_keys`。
