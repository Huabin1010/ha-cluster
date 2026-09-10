# 02 · 整体架构

> 上级：[00-index.md](00-index.md)  
> 选型：[01-tech-selection.md](01-tech-selection.md)

---

## 1. 逻辑视图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户侧                                  │
│  浏览器控制台 / CLI / SSH Client / (可选) Web IDE                │
└─────────────┬───────────────────────────┬───────────────────────┘
              │ HTTPS                     │ SSH
              ▼                           ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│  VPS 入口面               │   │  Bastion（跳板）                  │
│  OpenResty :443          │   │  认证 · ACL · 路由 · 会话审计      │
│  → ha-web / ha-api       │   └───────────────┬──────────────────┘
│  → code-server 反代      │                   │ 仅到已授权 Workspace
└─────────────┬────────────┘                   │
              │                                │
┌─────────────▼────────────────────────────────▼──────────────────┐
│                     Control Plane（VPS 常驻）                     │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌───────────┐ │
│  │ ha-api  │ │ Ledger  │ │ Orchest. │ │  Auth   │ │ k3s server│ │
│  │ REST    │ │ 账本DB  │ │ 编排器   │ │ 用户库  │ │ API :6443 │ │
│  └────┬────┘ └────┬────┘ └────┬─────┘ └────┬────┘ └─────┬─────┘ │
│       └───────────┴───────────┴────────────┘            │       │
│  PostgreSQL · EasyTier Hub · Depot · 备份任务      │       │
└───────────────────────────────┬─────────────────────────┘───────┘
                                │ EasyTier 10.129.129.0/24（见 easytier-fabric.mdc）
        ┌───────────────────────┼───────────────────────┬─────────────┐
        ▼                       ▼                       ▼             ▼
┌───────────────┐       ┌───────────────┐       ┌─────────────┐ ┌──────────────┐
│ Edge Hub      │       │ Relay 池      │       │ Worker 算力 │ │ CDN Depot    │
│ 10.129.129.1  │       │ .2 – .9       │       │ .10+        │ │ 公网 payload │
│ 任意 NAT/4G   │       │ 家宽/Wi-Fi    │       │ 公司网      │ │ 可选         │
│ easytier+incus│       │ easytier+incus│       │ easytier    │ │ payload 缓存 │
└───────────────┘       └───────────────┘       └─────────────┘ └──────────────┘
```

---

## 2. 组件职责

| 组件 | 职责 | 部署位置 |
|------|------|----------|
| **ha-web** | 控制台 UI | VPS / CDN 静态 + OpenResty |
| **ha-api** | 用户、项目、Workspace CRUD、触发编排 | VPS |
| **Ledger** | 容量池、套餐、Allocation 事务、防超卖 | 逻辑模块，数据在 PostgreSQL |
| **Orchestrator** | 选节点、调 Incus/k3s、健康检查、失败回滚 | VPS（可与 ha-api 同进程起步） |
| **Auth** | 注册登录、JWT、API Key、SSH 公钥绑定 | ha-api 内 |
| **Bastion** | SSH 入口、会话路由、审计 | VPS |
| **k3s server** | 集群 API、平台工作负载 | VPS |
| **k3s agent** | 节点注册、跑平台 Pod | 各 worker（node-ip=EasyTier） |
| **incus** | Workspace 实例生命周期 | 各 worker |
| **EasyTier** | 公共中枢：虚网、打洞、中继 | **每一台**设备；VPS 为公网 peer |
| **NPS/npc** | 仅遗留宝塔/旧 HTTP 入口 | VPS + 旧手机映射；**不承载集群** |
| **Depot** | 按架构提供安装 payload | overlay 内：控制面 + 可选节点 |
| **ha-setup / ha-agent** | 一包安装；心跳与容量上报 | 管理端 / 每个节点 |
| **OpenResty** | TLS、域名分流 | VPS |

---

## 3. 领域模型（简图）

```
User 1──* Membership *──1 Project 1──* Workspace
                │                         │
                │                         │1
                │                         ▼
                │                   Allocation（硬占用）
                │                         │
                └──────── Role            ▼
                                    ResourcePool / NodeCapacity
```

| 实体 | 关键字段（示意） |
|------|------------------|
| User | id, email, status, password_hash, mfa |
| Project | id, name, owner_id, plan_budget（可选总上限） |
| Membership | project_id, user_id, role(`owner\|admin\|dev\|viewer`) |
| Workspace | id, project_id, node_id, runtime(`incus\|k3s`), status, ssh_endpoint_ref |
| Allocation | id, workspace_id, cpu_milli, mem_bytes, disk_bytes, state(`reserved\|active\|released`) |
| Node | id, arch, class, power, tunnel, allocatable_*, reserved_system_*, labels |
| SSHKey | user_id, fingerprint, public_key |
| AuditLog | actor, action, object, at, meta |

---

## 4. 控制流：创建 Workspace（必须先占资源）

```
1. POST /projects/{id}/workspaces { plan: "large" }
2. ha-api 鉴权：成员 role ≥ dev
3. BEGIN TRANSACTION
   - 读套餐 large → cpu/mem/disk
   - 检查 Project 预算（若有）
   - 从 ResourcePool 扣减（WHERE free >= need）
   - INSERT Allocation state=reserved
   COMMIT 或失败返回 409 INSUFFICIENT_CAPACITY
4. Orchestrator 异步：
   - 选节点（**arch 硬匹配**、剩余容量、mains 优先、污点）
   - incus launch + limits 与 Allocation 一致
   - 注入 SSH 公钥、启动 sshd
   - 注册 Bastion 路由目标
   - Allocation → active；Workspace → running
5. 任一步失败：销毁残留 + Allocation → released（归还池）
```

**禁止**：先 `incus launch` 再记账。  
**禁止**：仅依赖节点上「看起来还有 free -h」而无中心账本。

---

## 5. 网络架构

### 5.1 南北向（用户流量）

| 流量 | 路径 |
|------|------|
| HTTPS 控制台/API | DNS → VPS OpenResty → ha-web / ha-api |
| HTTPS 应用/IDE | OpenResty → overlay 上节点/Ingress（遗留站仍可 NPS） |
| SSH | 用户 → Bastion → **EasyTier 虚 IP** → 节点上 Workspace:22 |

### 5.2 东西向（集群内部）

**底盘是 EasyTier `10.88.0.0/16`（优选）。** 节点虚 IP 互通。overlay **不是**控制台的前提，也不是 Workspace 存活的前提。分层与降级见 [12](12-easytier.md) §3。

- k3s `--node-ip` / `--flannel-iface=easytier`，优先 host-gw。
- Workspace 默认不广播到整张 overlay，只由 Bastion/平台打入。
- 不承诺等同局域网的带宽（4G 中继会慢）。

### 5.3 端口规划（增量）

| 端口 | 用途 | 备注 |
|------|------|------|
| 80/443 | OpenResty | **禁止**交给 NPS / EasyTier |
| 8088–8097 | NPS 旧隧道 | **勿抢**；不承载新集群 |
| **8099** | Bastion SSH（若 22 已占用） | 建议 |
| **9090** | Depot HTTP | **仅 overlay / 本机**，不对公网 |
| **6443** | k3s API | **仅 10.88.0.1**，不对公网 |
| **11010** | EasyTier UDP+TCP | 安全组放行；公共中枢 |
| **11011** | EasyTier WSS | 严防火墙 / 部分 4G 回退 |
| 5432 | PostgreSQL | 仅本机 |

---

## 6. 节点与调度

### 6.1 节点标签（建议）

```
kubernetes.io/arch=arm64|amd64
ha-cluster.mnnumath.vip/role=control-plane|worker|depot
ha-cluster.mnnumath.vip/power=battery|mains
ha-cluster.mnnumath.vip/network=public|lan|nat
ha-cluster.mnnumath.vip/runtime=incus|k3s|kvm|both
ha-cluster.mnnumath.vip/class=phone|sbc|desktop|server|cloud
ha-cluster.mnnumath.vip/tunnel=easytier
ha-cluster.mnnumath.vip/overlay-ip=10.88.0.x
```

完整画像见 [11-node-profiles.md](11-node-profiles.md)。

### 6.2 调度规则（Workspace）

1. **硬匹配** `arch`（套餐/镜像与节点一致；默认禁止 qemu 翻译）。
2. 节点 `allocatable - system_reserved - sum(active allocations on node) >= request`。
3. 优先 `power=mains`（x86 主机、SBC 常电）；电池手机降优先级。
4. 控制面机：**默认不调度**用户 Workspace（污点 `NoSchedule`）。
5. 节点 NotReady：不分配新实例；已有实例标 `degraded`；按策略重建到**同架构**其他节点（**数据默认不自动迁移**）。

---

## 7. 安全架构（分层）

```
[身份] User/JWT/SSH Key/OIDC
   ↓
[授权] Project RBAC + Bastion ACL + API scope
   ↓
[网络] 公网仅 Bastion/OpenResty/EasyTier 监听口；k3s 与 Depot 只在 10.88.0.0/16
   ↓
[运行时] 每 Workspace 独立 user ns / net ns / pid ns / 文件系统
   ↓
[数据] DB 备份加密；凭据不上 Git
   ↓
[审计] API AuditLog + Bastion session log（二期录像）
```

---

## 8. 部署视图（第一期单 VPS）

```
VPS (amd64, 10.88.0.1 中枢)
├── easytier-core（UDP/TCP/WSS 监听）
├── openresty · postgresql · ha-api · ha-web · bastion · k3s server
├── Depot :9090（overlay）
└── nps（仅遗留站点）

任意网络上的 worker（手机 / x86）
├── easytier-core（peer → VPS）
├── ha-agent · k3s agent · incus
└── 由 ha-setup 先入网再装齐
```

加节点路径见 [10-fast-installer.md](10-fast-installer.md)。 overlay 见 [12-easytier.md](12-easytier.md)。

高可用演进见 [08-ha-deployment.md](08-ha-deployment.md)。

---

## 9. 与「项目配额 YAML」的关系

仓库已有 `templates/project-large-4c2g.yaml`（Namespace + ResourceQuota）。

在本架构中它对应两种用途：

1. **k3s 项目模式**：用户不用 SSH 虚机，只用 `kubectl` 部署 → 仍 apply 该类清单，但 **创建前同样走 Ledger**。
2. **Workspace 模式**：Ledger 占 4c2g 后，Incus limits 对齐；不必为每个 Workspace 建同名 Quota，除非同时开 k3s ns。

同一 Project 可配置：`modes: [workspace, k8s]`，预算在账本层合并计算，防止两模式叠加上超卖。

---

## 10. 失败与一致性

| 场景 | 处理 |
|------|------|
| 账本扣减成功，Incus 失败 | 补偿事务释放 Allocation；告警 |
| 节点宕机 | Workspace `node_lost`；用户可「重建到其他节点」（空盘或从快照） |
| 跳板宕机 | SSH 不可用；HTTPS API 仍可（同 VPS 则一起挂 → 见 HA） |
| DB 主库挂 | 全写失败；只读可降级（二期） |
| 重复点击创建 | Idempotency-Key；唯一约束 `(project_id, name)` |

下一篇：[03-user-management.md](03-user-management.md)
