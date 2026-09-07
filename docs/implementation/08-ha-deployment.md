# 08 · 高可用部署

> 上级：[00-index.md](00-index.md)  
> 设备现实：[inventory.md](../inventory.md)

---

## 1. 「高可用」在本项目的含义

本集群节点包含**云主机、x86 Linux、ARM 板/手机**，**不能**按机房刀片双活承诺。分层定义：

| 级别 | 含义 | 一期目标 |
|------|------|----------|
| **HA-0** | 单 VPS 控制面；worker 可全部消失，API/DNS/证书仍在 | **必须** |
| **HA-1** | 控制面数据可恢复（备份/演练成功） | **必须** |
| **HA-2** | 双控制面或热备 VPS；入口可切换 | 二期 |
| **HA-3** | 跨可用区自动故障转移 | 非目标 |

用户可感知目标：

- 手机没电：控制台仍开得开；Workspace 标 lost。  
- **EasyTier 挂了：控制台仍开**；节点 `fabric_degraded`；虚机还在占配额；SSH 走破窗或等待。  
- 单 worker 挂：其他节点 Workspace 不受影响。  
- VPS 重启：分钟级恢复；有备份可重建账本与 k3s。

---

## 2. 故障域

```
[FD-VPS]   腾讯云：API、DB、Bastion、EasyTier 中枢、OpenResty、k3s、Depot
[FD-ET]    EasyTier 中继路径（当 P2P 失败时与 FD-VPS 重叠）
[FD-X86]   每台市电 x86 worker
[FD-P*]    各手机电池/无线
```

任意 `FD-P*` 失败应是常态。  
已打洞的节点在 VPS 短暂停时 **P2P 仍可能通**；新加入与纯中继节点依赖中枢。  
`FD-VPS` 长挂 = 入口+API+中继全断 → 二期第二公网 `et-relay`。

---

## 3. 一期拓扑（HA-0 + HA-1）

```
                 ┌──────────────────────────┐
                 │  VPS（控制面 + EasyTier 中枢 10.88.0.1）│
                 └────────────┬─────────────┘
                              │ overlay（打洞或中继）
         ┌──────────────┬─────┴──────┬──────────────┐
         ▼              ▼            ▼              ▼
      x86 主机        phone1      ginkgo         vince
      (市电,优先)     (电池)      (电池)         (电池)
      可选 LAN Depot
```

### 3.1 进程守护清单（VPS）

| 单元 | 重启策略 | 依赖 |
|------|----------|------|
| easytier-core | always | 网络；先于 k3s |
| openresty | always | 网络 |
| nps | always | 仅遗留站 |
| postgresql | always | 磁盘 |
| k3s | always | **After=easytier-core** |
| ha-api | always | postgresql |
| ha-bastion / sshd | always | easytier |
| backup.timer | 每日 | |

### 3.2 k3s

- server 仅市电控制面（现 VPS）；`--node-ip=10.88.0.1 --flannel-iface=easytier`
- API 不对公网开放 6443
- agent：由 **ha-setup** 安装，经 EasyTier 连 API
- **禁止** 在 `power=battery` 上装 k3s server

### 3.3 数据备份（HA-1 核心）

| 数据 | 频率 | 方式 | 保留 |
|------|------|------|------|
| PostgreSQL | 每 6h + 每日全量 | `pg_dump` / 基础备份 | ≥7 天 |
| k3s/etcd(sqlite) | 每日 | k3s 官方 snapshot | ≥7 天 |
| OpenResty 证书/站点 | 每日 | 文件同步 | 随系统盘快照 |
| Incus 用户盘 | 可选 | 用户触发导出 | 配额内 |
| 审计日志 | 随 DB | | |

**恢复演练：** 每季度在临时机 `pg_restore` + 启动 ha-api 只读验证。

备份加密与密钥放 `credentials.local.md` 流程，不进 Git。

---

## 4. Worker 侧高可用

### 4.1 工作负载

| 类型 | 策略 |
|------|------|
| Workspace（有状态盘） | **不**自动漂；用户「重建」到新节点（空盘或从快照） |
| k8s Deployment（无状态） | replicas≥2 且两节点在线时可容忍单节点；P1 网络限制下可能仍须同节点 |
| 平台组件 | 尽量只跑 VPS |

### 4.2 节点生命周期

```
加入：`ha-setup` → **先 EasyTier** → k3s/incus/ha-agent → 上报容量与虚 IP
封锁：cordon 等价（不再新分配）
排空：拒绝新分配 + 提示用户迁走
剔除：强制释放或迁移完成后从池删除
```

容量上报必须带时间戳；心跳超时 → `node_not_ready`，**冻结**其上新分配，但已有 Allocation 仍占用直到处理策略执行。

### 4.3 复制与多副本现实

副本只能落在**同架构** Ready 节点上。调度器应展示「当前 arch=X 的 Ready worker 数」。有市电 x86 时，无状态服务应优先复制到 x86，而不是两台可能同时没电的手机。

---

## 5. 二期：控制面 HA-2

### 5.1 方案 A：冷备 VPS

- 每日备份复制到第二台云主机；
- 主挂时人工改 DNS / 弹性 IP；
- RTO：数十分钟～数小时；RPO：备份间隔。

### 5.2 方案 B：双机热备（第二台用市电 x86 即可，不必再买云）

一台闲置 Linux 主机用 `ha-setup --role server` 加入控制面（流复制 PG / k3s 多 server），前提是**低延迟、常电**。手机永远不进此角色。

```
VIP / DNS RR
   ├── VPS-A：主 PostgreSQL + ha-api + Bastion + OpenResty
   └── VPS-B：热备 PG（流复制）+ 只读 API + 待命 Bastion
k3s：`--node-ip` 用各机 EasyTier 地址
EasyTier：两台都做 `--peers` 互指；虚 IP 10.88.0.1 / .2
遗留 NPS：与集群 HA 解耦，可暂留单点
```

手机 **npc 不再参与** 控制面切换。第二公网节点优先当 `et-relay`。

### 5.3 方案 C：托管 DB

- PostgreSQL 用云托管高可用版；
- VPS 变无状态应用机，可多副本；
- k3s 仍建议固定一台「有盘」机或外部 datastore。

**推荐演进：A → C → 视需要 B。**

---

## 6. 入口高可用

一期：单 OpenResty。  
缓解：

- 证书自动续期监控；
- 配置 git 化，可快速重装；
- 健康检查页 `/healthz`。

二期：第二入口机 + DNS 主备，或 Cloudflare 代理（按域名策略评估）。

**永不：** 把 80/443 交给 NPS 以求「HA」。

---

## 7. 跳板高可用

| 阶段 | 做法 |
|------|------|
| 一期 | systemd + 监控；挂则告警 |
| 二期 | 第二 Bastion + 同一用户 ACL 来源（DB）；DNS 主备 |
| Teleport | 集群模式（官方 HA 文档） |

会话中断：SSH 本身不持久；用户重连即可。长任务应在 Workspace 内用 `tmux`/`systemd`。

---

## 8. 依赖项可用性

| 依赖 | 风险 | 缓解 |
|------|------|------|
| EasyTier 中枢 | VPS 单点影响中继与新加入 | systemd；二期第二 `et-relay`；已 P2P 可暂存 |
| NPS | 仅遗留站点 | 与集群解耦 |
| 公网镜像 | 慢/失败 | Depot 走 overlay，禁止安装路径依赖 Docker Hub |
| 电源/Wi-Fi | 手机 | 调度优先 mains；vince 避 HUD |
| 腾讯云单机 | 磁盘坏 | 云盘快照 + 异地 dump；二期控制面扩到家用 x86 |

---

## 9. 监控与告警（最小）

必须告警：

1. VPS disk &gt; 85%  
2. PostgreSQL / k3s / ha-api / nps / openresty down  
3. 备份任务失败  
4. 节点心跳丢失  
5. 账本对账漂移  
6. 证书到期 &lt; 14 天  

通知：邮件 / Webhook；不做复杂 on-call。

---

## 10. 发布与回滚

- ha-api：二进制/镜像滚动；DB 迁移向前兼容；
- 失败：保留上一版本 unit `ExecStart`；
- 大迁移：先备份再执行。

---

## 11. 灾难恢复 Runbook（摘要）

1. 新 VPS 装基础包与 OpenResty/NPS；  
2. 恢复 PostgreSQL；  
3. 恢复 k3s snapshot（或重建 server，worker 重加）；  
4. 启动 ha-api；对账 Incus（可能全丢 → 用户重建 Workspace）；  
5. 验证 Bastion、域名、一套测试 Workspace；  
6. 更新 DNS/安全组。  

RPO/RTO 写进对外说明，避免「云级 HA」误解。

---

## 12. 验收

| # | 项 |
|---|-----|
| 1 | 全部手机关机：控制台登录成功；kubectl/get nodes 可见 NotReady |
| 2 | 杀一台 worker：其他 Workspace SSH 仍通 |
| 3 | 模拟恢复：从昨日 pg_dump 恢复到空库，用户数据在 |
| 4 | VPS 重启后所有 systemd 自动起来，5 分钟内服务可用 |
| 5 | 备份失败能收到告警 |

下一篇：[09-roadmap.md](09-roadmap.md)
