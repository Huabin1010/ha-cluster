# 23 · 主节点、调度节点与 EasyTier 流量拓扑

> 上级索引：[00-index.md](00-index.md)  
> 关联：[12-easytier.md](12-easytier.md)、[19-resource-allocation-ssh-and-ingress-design.md](19-resource-allocation-ssh-and-ingress-design.md)、[22-project-machine-concepts.md](22-project-machine-concepts.md)  
> Fabric 参数以 [.cursor/rules/easytier-fabric.mdc](../../.cursor/rules/easytier-fabric.mdc) 为准（`10.129.129.0/24`）  
> 文档性质：**网络与入口分层定稿**（用户口述与工程落地的对齐稿）

---

## 1. 核心结论（一句话）

**所有域名只解析到一台「轻量、常在线」的入口机；它加入 EasyTier、终结 TLS，并把请求负载均衡到多台调度节点。调度节点经虚网把流量送到算力节点上的 Workspace。入口机不跑用户业务、不背转发压力。**

算力节点（手机、PC、实验室机等）**只通过 EasyTier 加入集群**，不直接暴露公网业务端口。

---

## 2. 设计思想：为什么要拆成三层

你要保证的是：**「域名那一层」永远有一台机器在线**。这台机器应该尽可能「轻」——只做门面，不做重活。

| 层次 | 你要保证什么 | 怎么做 |
|------|--------------|--------|
| **入口（Edge）** | DNS 指向的机器 **始终在线** | 小 VPS、进程少、只 Nginx + EasyTier Hub；不做用户容器、不直连每台 worker |
| **调度池（Relay）** | 转发能力 **可扩展、可容错** | 多台常电机；入口对它们 **负载均衡**；挂一台换一台 |
| **算力（Worker）** | 算力 **可断、可移动** | 手机/实验室机随时离线；断了只影响自己的服务，不影响入口域名 |

类比：

```
入口机  = 商场大门 + 收银台（固定地址，永远开着）
调度节点 = 导购台（多位导购，客人随机分配，有人下班换别人）
算力节点 = 后仓货架（货在哪，导购去后仓取）
```

入口机 **不需要知道** 每个 Workspace 在哪台 worker 上；它只需要知道 **调度池里有哪些健康的 Relay**。  
真正查「`demo.apps.xxx` → `10.129.129.15:18080`」的是 **调度节点**（读控制面下发的路由表）。

---

## 3. 四类节点角色

| 角色 | 日常叫法 | 平台术语 | 主要职责 |
|------|----------|----------|----------|
| **入口机** | 主节点 / 域名机 | **Edge Entry** | 公网 IP、DNS 落点、**轻量 Nginx**、TLS、**LB → 调度池**、EasyTier Hub |
| **控制面** | （可与入口同机） | **Control Plane** | `ha-api`、DB、控制台、Bastion、路由元数据；**可与入口分机部署** |
| **调度节点** | 中继机 | **Ingress Relay** | 接收入口转发的 HTTP；按 Host 查表；经 EasyTier 打到 worker |
| **算力节点** | Worker / 宿主机 | `worker` **Node** | `ha-agent` + Incus；跑 Workspace |

> **命名注意：** 「调度节点」= **流量中继**，不是账本里选机器创建工作区的 Orchestrator（见 [07-resource-ledger.md](07-resource-ledger.md)）。

### 3.1 入口机（Edge Entry）— 轻量、常在线

**产品承诺：** 你保证 **域名解析到的这一台** 始终在线；因此它必须 **极轻**。

**必装组件（尽量少）：**

| 组件 | 作用 |
|------|------|
| `easytier-core` | Hub + 自身入 mesh（虚 IP `10.129.129.1`） |
| OpenResty / Nginx | 443 TLS、按域名分流、**upstream 指向调度池** |
| 证书续签 | 泛域名 `*.apps.example.com` |

**入口机上的 Nginx 只做两类事：**

1. **平台面**（可选与入口同机）：`console.example.com`、`/api` → 本地或内网控制面。  
2. **用户业务面**：`*.apps.example.com` → **统一 `proxy_pass` 到调度池**（`least_conn` / `round_robin`），**不**在入口配置每台 worker 的 IP。

```nginx
# 入口机：所有用户 Ingress 共用一个 upstream 池（示意）
upstream ha_relay_pool {
    least_conn;
    server 10.129.129.2:8443 max_fails=2 fail_timeout=10s;
    server 10.129.129.3:8443 max_fails=2 fail_timeout=10s;
    server 10.129.129.4:8443 max_fails=2 fail_timeout=10s;
}

server {
    listen 443 ssl http2;
    server_name *.apps.example.com;
    # ... ssl_certificate ...

    location / {
        proxy_pass http://ha_relay_pool;
        proxy_set_header Host $host;          # 调度节点靠 Host 查后端
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**入口机刻意不做：**

- 用户 Workspace / Incus；
- 按路由直连 worker（那是调度节点的活）；
- 重 CPU 转发（连接数大时由调度池横向扩）。

控制面（`ha-api`、PostgreSQL）**可以**与入口同机（省事），也可以放到内网第二台；**用户业务流量不依赖 DB 热路径**。入口挂了只影响「从公网进来」，不影响 worker 上已跑的容器。

### 3.2 调度节点（Ingress Relay）— 可多台、可扩容

- 虚 IP 建议占用 `10.129.129.2` – `.9`（Hub 与 worker 段之间的 **调度池段**，见 §5）。
- 公网 **无** DNS 记录；只从入口机经 **EasyTier** 访问（如 `10.129.129.2:8443`）。
- 每台调度节点运行 **Relay Nginx**（或 `ha-ingress-relay`）：
  1. 监听虚网端口（如 `8443`）；
  2. 根据请求 `Host`（及路径）查 **本地同步的路由表**；
  3. `proxy_pass http://<worker_fabric_ip>:<host_port>`。

**入口对调度池做负载均衡：**

| 策略 | 适用 |
|------|------|
| `least_conn` | 默认推荐；长连接、WebSocket 更均衡 |
| `round_robin` | 调度节点规格一致、请求短 |
| `ip_hash` | 需要同一客户端粘到同一 Relay（少见） |
| `max_fails` + `fail_timeout` | Relay 宕机自动剔除，恢复后自动加回 |

**调度节点挂了的体验：** 入口 LB 跳过它，其余 Relay 继续服务；仅经过该 Relay 的进行中长连接会断。

**扩容：** 新加一台 Relay → 加入 EasyTier → 分配 `.2`–`.9` 中空闲 IP → 入口 `upstream` 加一行 → `reload`。无需改 DNS。

### 3.3 算力节点（Worker）

- 通过 `ha-setup join` / EasyTier **仅加入虚网**，无公网业务端口要求。
- 虚 IP 从 `10.129.129.10` 起分配（线上 worker）；PVE 测试用 `.205` 起，见 fabric 规则。
- `ha-agent` 监听 **仅绑定 `fabric_ip`**（如 `:9091` 编排 API）。
- Workspace 内服务（如 `:8080`）由 agent 在宿主机上映射为 **`fabric_ip:host_port`**，供调度节点反代。

---

## 4. 流量路径（HTTP / HTTPS）

### 4.1 逻辑拓扑（目标形态）

```
                         公网用户
                             │
                             │ HTTPS :443
                             ▼
               ┌─────────────────────────┐
               │  入口机 Edge（常在线）    │
               │  公网 110.40.229.62      │
               │  虚网 10.129.129.1       │
               │  · TLS 终结              │
               │  · LB → 调度池           │  ← 轻量：只知 Relay 列表
               │  · EasyTier Hub          │
               └────────────┬────────────┘
                            │ least_conn / round_robin
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Relay .2   │  │ Relay .3   │  │ Relay .4   │  调度池（可扩）
     │ :8443      │  │ :8443      │  │ :8443      │
     └──────┬─────┘  └──────┬─────┘  └──────┬─────┘
            │               │               │
            └───────────────┼───────────────┘
                            │ EasyTier（按 Host 查表 → worker）
                            ▼
               ┌─────────────────────────┐
               │  算力节点 Worker .15     │
               │  host_port → WS :8080    │
               └────────────┬────────────┘
                            ▼
                    Workspace 内应用
```

### 4.2 逐步说明

1. **DNS** — `demo.apps.example.com` → A 记录 → **仅入口机公网 IP**。

2. **入口机** — SSL 解密；`*.apps` 全部 `proxy_pass` 到 `ha_relay_pool`；**保留 `Host` 头**。

3. **调度节点（池中任选一台）** — 用 `Host: demo.apps.example.com` 查路由表 → `10.129.129.15:18080` → `proxy_pass`。

4. **算力节点** — `ha-agent` 把 `host_port` 转到 Workspace 内服务端口。

### 4.3 配置谁生成、写在哪

| 配置 | 生成者 | 部署位置 |
|------|--------|----------|
| `upstream ha_relay_pool { ... }` | 平台（节点上下线时） | **仅入口机** |
| 每条 `demo.apps → worker:port` | `ha-api` 审批 Ingress 后 | **每台调度节点**（同步同一张表） |
| `host_port` 绑定 | `ha-agent` | **算力节点** |

入口机 **配置文件行数 ≈ 常数**（一个 server + 一个 upstream 池），不随用户域名数量线性增长——这是「轻量」的关键。

### 4.4 与「创建 Workspace」编排的关系

两条链路 **并行、解耦**：

| 链路 | 何时发生 | 谁负责 |
|------|----------|--------|
| **资源编排** | 用户申请机器、审批通过 | 控制面 Orchestrator + Ledger → 选 **算力节点** → `ha-agent Launch` |
| **流量编排** | 用户申请域名、审批通过 | `ha-api` 写 `ingress_routes` → 渲染 Nginx → 主节点 + 调度节点 upstream |

一台 Workspace 落在 `10.129.129.15` 上，其域名路由在 DB 里记录 `fabric_ip` + `port`；入口与调度层 **只读元数据转发**，不参与 Incus 生命周期。

---

## 5. EasyTier 组网与 IP 分段

所有节点同属一张网：

| 段 | 虚 IP 范围 | 数量 | 用途 |
|----|------------|------|------|
| **Hub / 入口** | `10.129.129.1` | 1 | EasyTier 中枢 + 入口 Nginx |
| **调度池** | `10.129.129.2` – `.9` | 8 | Ingress Relay（建议预留，可先用 2～3 台） |
| **缓冲** | `.2`–`.9` 未用完前勿动 | — | 与 worker 段隔离 |
| **线上 worker** | `10.129.129.10` – `.204` | 195 | 算力节点 |
| **本地 / PVE 测试** | `10.129.129.205` – `.254` | 50 | 测试 VM |

| 项 | 值 |
|----|-----|
| 网络名 | `ha-cluster-easytier` |
| 网段 | `10.129.129.0/24` |
| Hub 公网 peer | `110.40.229.62:15010`（UDP + TCP） |

Worker 加入参数：`--no-listener`，`--peers udp://110.40.229.62:15010`（及 TCP 回退）。  
主节点 Hub：`--listeners udp://0.0.0.0:15010 tcp://0.0.0.0:15010`。

**原则：** k3s `node-ip`、Bastion 后端、`ha-agent` API、Ingress upstream **一律使用 `fabric_ip`**，不依赖 worker 公网 IP 或 NPS 隧道。

---

## 6. 入口机「轻量」检查清单

| 应该做 | 不应该做（用户业务面） |
|--------|------------------------|
| 公网 443 TLS + 泛域名证书 | 跑用户 Workspace |
| `*.apps` → 调度池 LB | 在入口写每条路由的 worker IP |
| EasyTier Hub / 中继 | 把算力池可售容量开在入口机上 |
| 健康检查调度池成员 | 让 DNS 指向 worker / relay 公网 IP |
| （可选）控制台 `/api`、Bastion | 在入口承担大流量转发（应 offload 到 Relay） |

---

## 7. SSH 与 HTTP 入口对比

| 类型 | 公网入口 | 第一跳 | 第二跳（虚网） | 终点 |
|------|----------|--------|----------------|------|
| **HTTPS 业务** | 主节点 :443 | 调度节点 Relay | EasyTier → 算力节点 `host_port` | Workspace 内 HTTP |
| **SSH** | 主节点 Bastion :22/2222 | （Bastion 进程） | EasyTier → 算力节点 SSH 映射 | Workspace sshd |

SSH **不经过**调度节点 Nginx；Bastion 在主节点上按 Workspace ID 直连算力节点虚 IP（与 [06-bastion-routing.md](06-bastion-routing.md) 一致）。  
HTTP 走 **入口机 → 调度池（LB）→ 算力节点** 三层。

---

## 8. 分期落地

### P0 · 现在（单机验证）

入口机 **兼任唯一 Relay**，逻辑上仍是两层，但物理一台：

```nginx
# 入口 upstream 只有本机 loopback 或 10.129.129.1:8443
upstream ha_relay_pool {
    server 127.0.0.1:8443;   # 本机第二个 nginx / relay 进程
}
```

或暂时在 Relay 进程未拆时，`proxy_pass` 直连 worker（与现有 `internal/ingress/nginx.go` 一致），**尽快迁到 P1**。

### P1 · 目标最小集（推荐下一步）

| 机器 | 角色 |
|------|------|
| 1 台小 VPS | 入口 + Hub + 入口 Nginx（只 LB） |
| 1～2 台常电 x86 | 调度节点 Relay（`.2`、`.3`） |
| N 台 | 算力 worker |

验收：关掉 Relay `.3`，入口自动剔除，服务不中断；DNS 始终只指入口。

### P2 · 调度池扩容

- Relay 加到 `.4`–`.9`；
- 入口只改 `upstream` 一行；
- `ha-api` 向所有 Relay 推送路由表（或 Relay 定时拉 `GET /internal/ingress/routes`）。

### P3 · 双入口（可选）

两台入口 VPS + Keepalived / Anycast，DNS 仍一个逻辑地址。与 [08-ha-deployment.md](08-ha-deployment.md) 二期对齐。**仍保持每台入口轻量。**

---

## 9. 降级与韧性（与 EasyTier 策略一致）

| 场景 | 行为 |
|------|------|
| EasyTier 抖动 | 控制台 / 主节点 API **仍可用**（公网 443 不依赖 overlay） |
| 算力节点 overlay 断 | Ingress 502；**不删除** Workspace；心跳可降级 HTTPS 上报 |
| 单台 Relay 不可用 | 入口 LB 剔除；其余 Relay 承接 |
| 调度池全挂 | 用户 Ingress 502；控制台/API 仍可访问 |
| 入口机宕机 | 公网全断；worker 本地 Workspace **仍运行** |

详见 [12-easytier.md](12-easytier.md) §3 三平面模型。

---

## 10. 数据模型扩展（示意）

`ingress_routes` 在现有字段基础上，建议区分：

| 字段 | 含义 |
|------|------|
| `worker_fabric_ip` | 算力节点虚 IP（最终 upstream） |
| `host_port` | 宿主机映射端口 |
| `relay_pool` | 入口 upstream 成员列表（节点 ID + fabric_ip + 端口） |
| `entry_rendered` | 入口机是否已 reload |
| `relay_rendered_at` | 各 Relay 最后同步时间 |

审批通过后：`pending_approval` → `active` → **推送路由到所有 Relay** → Relay 就绪后入口无需改配置（Host 已在请求头里）。

---

## 11. 验收清单

- [ ] 所有业务域名 DNS **仅**指向入口机公网 IP  
- [ ] 入口机 Nginx 配置 **不**随域名数量线性增长（一个 `*.apps` server + 一个 relay pool）  
- [ ] 入口机无用户 Workspace；转发压力可由 Relay 承担  
- [ ] ≥2 台 Relay 时，关停一台后公网访问仍成功  
- [ ] 算力节点无公网入站；仅虚网 `host_port` 可达  
- [ ] `fabric_ip` 符合 [easytier-fabric](../../.cursor/rules/easytier-fabric.mdc) 分段表  

---

## 12. 文档关系

- 域名审批与 Nginx 模板：[19-resource-allocation-ssh-and-ingress-design.md](19-resource-allocation-ssh-and-ingress-design.md) §5  
- Ingress 审批状态机：[21-core-pipeline-spec.md](21-core-pipeline-spec.md) §5  
- 项目与工作区概念：[22-project-machine-concepts.md](22-project-machine-concepts.md)  
- 旧文档中的 `10.88.0.0/16` 已废弃，以 `10.129.129.0/24` 为准  
