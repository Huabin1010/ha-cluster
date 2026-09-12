# 生产部署：42 控制面 + 110 Hub + PVE Worker

## 角色

| 主机 | 角色 | Fabric IP |
|------|------|-----------|
| `110.40.229.62` | EasyTier Hub only | `10.129.129.1` |
| `42.193.236.123` | 控制面 + 公网入口 | **`10.129.129.253`** |
| PVE `192.168.1.8` | Worker 算力 | `.205–.252` 或 `.10+` |

部署目录：`/www/wwwroot/cl.qzsyzn.com/docker`  
控制台：`https://cl.qzsyzn.com`（宝塔反代 → `127.0.0.1:18082`）  
管理员：`admin` / `123456qq`

## 阶段 0 — 主机准备

```bash
scp deploy/prod/prep-host.sh root@42.193.236.123:/tmp/
ssh root@42.193.236.123 'bash /tmp/prep-host.sh'
```

## 阶段 1 — 控制面

1. 复制 `.env.example` → `.env`，填强随机 `HA_JWT_SECRET` / DB / node token。
2. 部署：

```bash
# Windows 可用 scp + ssh 手工；Linux/macOS：
bash deploy/prod/deploy-remote.sh
```

3. 验收：`curl -fsS http://127.0.0.1:18082/healthz`（在 42 上）

## 阶段 2 — EasyTier peer

```bash
export HA_ET_SECRET='…'   # 见 credentials.local.md，勿提交
scp deploy/prod/install-easytier-peer.sh root@42.193.236.123:/tmp/
# 先确保 /usr/local/bin/easytier-core 存在（可从 Depot bin/amd64/easytier-core 拉取）
ssh root@42.193.236.123 "HA_ET_SECRET='$HA_ET_SECRET' bash /tmp/install-easytier-peer.sh"
ping -c 3 10.129.129.1   # 在 42 上
```

## 阶段 3 — 宝塔 API 建站/反代/SSL

凭据写入 `docs/credentials.local.md`：

```
HA_BT_PANEL=http://42.193.236.123:8888
HA_BT_KEY=<面板 API 密钥>
```

```bash
export HA_BT_PANEL=http://42.193.236.123:8888
export HA_BT_KEY=...
python deploy/prod/baota_api.py ping
python deploy/prod/baota_api.py setup-cl --domain cl.qzsyzn.com --target http://127.0.0.1:18082
```

公网 DNS 也可经宝塔 **DNSPod 插件** API 添加（面板需已绑定腾讯云密钥）：

```bash
python deploy/prod/baota_api.py ensure-dns --domains 'cl.qzsyzn.com,*.cl.qzsyzn.com'
python deploy/prod/baota_api.py ensure-ssl --domain cl.qzsyzn.com
```

**当前状态**：`cl` / `*.cl` A 记录 → `42.193.236.123` 已写入；HTTPS 已挂载。

## 阶段 4 — PVE Worker 纳管

控制台生成 join token（**公网 Depot**），`api=https://cl.qzsyzn.com/api`，`et_peer=tcp://110.40.229.62:15010`。  
在 PVE VM 执行控制台给出的一行命令。勿在 110/42 上跑 Workspace。

## 阶段 5 — Ingress

控制台「域名配置」已登记公共域 `cl.qzsyzn.com` / `apps.cl.qzsyzn.com`（`bootstrap-console.py`）。  
工作区领取子域后，入口经宝塔 →（后续 Relay）→ Worker fabric。

PortForward / Bastion 后置：公网勿抢 22；独立端口 + EasyTier 到 Workspace。

## 阶段 6 — 带宽演进（后置，不阻塞首期）

42 带宽不足时：把 **443 Edge** 迁到高带宽机；42 只留 `ha-api`+DB；Hub 仍只做 EasyTier。  
首期业务流量经 42 反代仍会占用其公网带宽——这是已知取舍，见计划「阶段 6」。

## 安全

- `.env`、宝塔密钥、EasyTier 密钥禁止进 Git
- Postgres / `18082` 不对公网
- 宝塔 API IP 白名单需放行调用机
