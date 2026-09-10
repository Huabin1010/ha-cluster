# 27 · 项目机器监控、双运行环境与创建时自动注入

> 上级索引：[00-index.md](00-index.md)  
> 关联：[22-project-machine-concepts.md](22-project-machine-concepts.md)、[05-ssh-isolation.md](05-ssh-isolation.md)、[07-resource-ledger.md](07-resource-ledger.md)、[21-core-pipeline-spec.md](21-core-pipeline-spec.md)  
> 文档性质：**产品概念定稿**（项目内可观测性、运行时选型、启动注入）

---

## 1. 用户在项目里看到什么

在 **项目维度** 查看本项目下 **全部机器（Workspace）** 的运行状态，而不是只能进单机详情。

### 1.1 列表页（项目 → 服务器）

| 列 / 卡片 | 内容 |
|-----------|------|
| 名称 / 状态 | `running` / `stopped` / `requested` / … |
| **运行环境** | `Docker + SSH` 或 `Kubernetes`（见 §3） |
| **CPU** | 配额 vs 近期使用率（%） |
| **内存** | 配额 vs 已用 / 可用 |
| **硬盘** | 配额 vs 已用（卷内） |
| 架构 | `amd64` / `arm64` |
| 操作 | SSH、网络暴露、审批待办 |

筛选：按状态、运行环境、架构；排序：按 CPU/内存使用率。

### 1.2 单机详情页（曲线图）

进入某台机器后展示 **近期时序**（建议默认 **24h**，可切换 1h / 7d）：

| 指标 | 说明 |
|------|------|
| CPU 使用率 | 占 **配额** 的百分比（非宿主机整机） |
| 内存使用 | 已用 MiB / 配额 MiB |
| 磁盘使用 | 根文件系统或数据卷已用 / 配额 |
| 网络（二期） | 入站/出站吞吐 |

图表：折线图（前端 shadcn + 图表库，如 recharts）；数据点间隔与采集周期一致（默认 **15s**，与 agent 心跳对齐）。

### 1.3 数据来源

```
┌─────────────────┐     每 15s      ┌──────────────┐
│ ha-agent        │ ──────────────► │ ha-api       │
│（每台 worker）   │  workspace +   │ 时序存储      │
│ cgroup / statfs │  node 指标     │ + 列表 API    │
└─────────────────┘                └──────┬───────┘
                                          │
                                          ▼
                                   项目控制台 / 曲线图
```

| 层级 | 已有 | 待扩展 |
|------|------|--------|
| **Node（宿主机）** | 心跳含 `cpu_usage_pct`、`mem_available_bytes`、`disk_free_bytes` | 节点页已有卡片 |
| **Workspace（机器）** | 仅有配额字段；无时序 | **workspace_metrics** 表 + agent 上报容器 cgroup |

建议 API：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects/{id}/workspaces` | 列表含最新快照指标 |
| GET | `/workspaces/{id}/metrics?range=24h` | 时序点数组 |
| GET | `/projects/{id}/workspaces/summary` | 聚合：运行数、总 CPU/内存占用率 |

权限：`viewer+` 可看；`developer+` 可操作。

> **实现状态：** 节点级指标 **部分已有**（`Nodes.tsx`）；**Workspace 级曲线与项目聚合视图待实现**。

---

## 2. 监控指标定义

### 2.1 Workspace 快照（列表用）

```json
{
  "workspace_id": "uuid",
  "cpu_usage_pct": 42.5,
  "mem_used_bytes": 1073741824,
  "mem_limit_bytes": 2147483648,
  "disk_used_bytes": 3221225472,
  "disk_limit_bytes": 5368709120,
  "collected_at": "2026-09-10T10:00:00Z"
}
```

### 2.2 时序点（曲线用）

```json
{
  "metric": "cpu_pct",
  "points": [
    { "t": "2026-09-10T09:00:00Z", "v": 12.1 },
    { "t": "2026-09-10T09:00:15Z", "v": 15.3 }
  ]
}
```

保留策略：原始 15s 点保留 **7 天**；之后按小时降采样（运维可配）。

### 2.3 agent 采集方式

- **Docker + SSH（Incus）**：读实例 cgroup（`cpu.stat`、`memory.current`）与容器内 `df` / statfs。
- **Kubernetes**：读 Namespace 下 Pod 的 `metrics.kubelet` 汇总，或 cAdvisor 代理（P2）。

---

## 3. 两种运行环境

用户创建机器时选择 **运行环境**；对用户统一叫「服务器」，底层实现不同。

| 用户选项 | `runtime` 值 | 体验 | 底层（P1/P2） |
|----------|--------------|------|----------------|
| **Docker + SSH** | `container` | 完整 Linux，SSH 登录，`docker` 可用 | **Incus 系统容器** + cloud-init（**默认**） |
| **Kubernetes** | `k8s` | `kubectl apply`、Deployment/Service；可选下发 kubeconfig | 项目对应 **k3s Namespace + ResourceQuota** |

```
用户创建机器
  ├─ runtime=container → ha-agent Launch（Incus）
  └─ runtime=k8s       → 创建 ns + quota +（可选）默认 Helm/清单
```

### 3.1 Docker + SSH（`container`）— P1 主路径

- 独立文件系统、systemd、SSH（见 [05-ssh-isolation.md](05-ssh-isolation.md)）。
- **创建时自动注入**（§4）：Docker、SSH 公钥、基础工具。
- 适合：交互开发、长驻进程、需要 `docker run` 的场景。

### 3.2 Kubernetes（`k8s`）— P2

- 映射 PRD：项目 = Namespace，套餐 = ResourceQuota + LimitRange。
- 用户通过控制台或 kubeconfig 部署；平台负责配额与 arch 匹配。
- 适合：无状态服务、多副本、Ingress 与集群内 Service。
- **同一项目可同时存在** 多台 `container` 机与 `k8s` 配额环境（不同 Workspace 记录）。

### 3.3 创建表单

| 字段 | 说明 |
|------|------|
| 项目 | 必选 |
| 套餐 / 架构 | 已有 |
| **运行环境** | 单选：`Docker + SSH` \| `Kubernetes` |
| 可见性 | shared / private |

`arch` 与 `runtime=k8s` 时调度到对应 arch 的 k3s worker；`container` 调度到 Incus 节点。

---

## 4. 创建时自动注入环境

**原则：** 审批通过 → Launch 一次完成；用户 **首连 SSH 或首条 kubectl** 即可用，无需手工 `apt install`。

### 4.1 所有运行环境共有

| 注入项 | 时机 | 实现 |
|--------|------|------|
| SSH 公钥 | Launch | `authorized_keys`（[24-ssh-access-and-approval.md](24-ssh-access-and-approval.md)） |
| 主机名 / 时区 | Launch | cloud-init 或 Incus config |
| 配额 cgroup | Launch | `limits.cpu` / `limits.memory` / 磁盘卷大小 |
| 项目环境变量（可选） | Launch / 热更新 | `cloud-init` `write_files` 或 `/etc/ha/env`（P2） |

### 4.2 Docker + SSH（`container`）— 已有基线

当前 `internal/workspace/incus.go` 通过 **cloud-init** 注入：

```yaml
#cloud-config
package_update: true
packages:
  - docker.io
  - rsync
runcmd:
  - systemctl enable --now docker
```

创建流程：

```
ApproveWorkspace
  → Ledger Reserve
  → ha-agent POST /v1/workspaces/launch
       ├─ Incus launch + 磁盘 + cgroup
       ├─ cloud-init：docker.io、rsync、启用 docker
       ├─ SSH 公钥注入
       └─ ExposePort（SSH / Ingress 用）
  → status=running
```

**待增强：**

- 可选 **环境模板**（`dev-node`、`dev-go`…）：额外包装列表。
- 项目级 **Secrets** 注入为文件或 env（加密存储，Launch 时下发）。

### 4.3 Kubernetes（`k8s`）

Launch 时控制面自动：

1. `kubectl create namespace proj-<slug>-<ws-short>`（若不存在）。
2. 应用 ResourceQuota / LimitRange（来自套餐）。
3. 创建项目 ServiceAccount + RoleBinding。
4. 生成 **受限 kubeconfig** 写入 Secret；控制台提供下载。
5. （可选）部署默认 `NetworkPolicy` 隔离。

用户不感知 Namespace 名称规则；控制台显示「集群环境已就绪」。

### 4.4 注入失败策略

- SSH / docker 启动失败 → `WSFailed`，释放或保留 Allocation 按策略；审计 `workspace.launch.failed`。
- 部分包安装慢 → agent 上报 `provisioning` 子状态；超时 5min 失败回滚（见 [21-core-pipeline-spec.md](21-core-pipeline-spec.md)）。

---

## 5. 控制台信息架构

```
项目详情
├── 成员
├── 服务器（列表 + 监控快照）     ← §1.1
│     └── [机器名] 详情
│           ├── 概览（状态、配额、运行环境）
│           ├── 监控曲线（CPU/内存/磁盘）  ← §1.2
│           ├── SSH / 连接
│           └── 网络暴露（Ingress / 端口转发）
└── 用量 / 预算
```

---

## 6. 数据模型扩展（建议）

**workspaces 表：**

| 字段 | 说明 |
|------|------|
| `runtime` | `container` \| `k8s`（默认 `container`） |
| `runtime_ref` | Incus 实例名 或 k8s namespace 名 |

**workspace_metrics 表（时序）：**

| 字段 | 说明 |
|------|------|
| workspace_id | FK |
| ts | timestamptz |
| cpu_usage_pct | float |
| mem_used_bytes | bigint |
| disk_used_bytes | bigint |

**workspace_metrics_latest 视图或缓存**：列表页免扫全表。

---

## 7. 与现有实现的关系

| 能力 | 现状 | 本文拍板 |
|------|------|----------|
| 项目下 Workspace 列表 | ✓ `Workspaces.tsx` | 增加监控列 |
| 节点 CPU/内存/磁盘 | ✓ 心跳 + `Nodes.tsx` | 保持 |
| Workspace 曲线图 | ✗ | agent 上报 + 新 API + 图表页 |
| 运行环境二选一 | ✗ 仅 Incus | 增加 `runtime` 字段与创建表单项 |
| 创建注入 Docker+SSH | ✓ `dockerCloudInit` | 保持并扩展模板/项目 env |
| k8s 环境自动建 ns/quota | ✗ PRD 有、未接 Workspace | P2 与 `runtime=k8s` 绑定 |

---

## 8. 验收清单

- [ ] 项目「服务器」列表展示每台机器的 CPU/内存/磁盘 **快照**  
- [ ] 单机详情有 **24h 曲线**（至少 CPU、内存）  
- [ ] 创建时可选择 **Docker + SSH** 或 **Kubernetes**  
- [ ] `container` 审批通过后 **无需手工装 Docker** 即可 `docker ps`  
- [ ] `k8s` 审批通过后可下载 **kubeconfig** 且配额与套餐一致  
- [ ] `viewer` 可看监控，`developer` 可创建机器  

---

## 9. 文档关系

- 机器与审批：[22-project-machine-concepts.md](22-project-machine-concepts.md)  
- Agent Launch 契约：[21-core-pipeline-spec.md](21-core-pipeline-spec.md) §2  
- 分阶段运行时：[00-index.md](00-index.md) §2.1（P1 Incus / P2 k8s）  
