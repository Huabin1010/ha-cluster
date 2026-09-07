# 09 · 实施路线图与任务拆解

> 上级：[00-index.md](00-index.md)  
> 本文把前面设计落成可执行里程碑。  
> 仓库软件 MVP 之后、上线前的运维五事：[13-remaining-tasks.md](13-remaining-tasks.md)；UI 与测试分工：[14-ui-and-qa-tasks.md](14-ui-and-qa-tasks.md)

---

## 1. 总时间线（建议）

| 里程碑 | 主题 | 预估（单人兼职） | 依赖 |
|--------|------|------------------|------|
| **M0** | 文档与拍板 | 已完成（本目录） | — |
| **M1** | 控制面 + **EasyTier 中枢** + Depot + ha-setup | 1–2 周 | VPS 安全组 11010/11011 |
| **M2** | 首个硬占用 Workspace + 跳板 SSH | 2–3 周 | M1、至少 1 worker（x86 或手机） |
| **M3** | 用户系统与项目协作 | 1–2 周 | M2 |
| **M4** | 多节点调度、入口、对账 | 1–2 周 | 2+ worker |
| **M5** | HA-1 备份演练 + 监控 | 1 周 | M1 |
| **M6** | 控制台打磨 / Teleport / 可选微虚机 | 持续 | M3–M5 |

可并行：M5 备份与 M3 用户系统。

---

## 2. M0 · 文档（完成标准）

- [x] PRD + inventory  
- [x] 实施文档 00–11  
- [ ] 开放问题拍板记录写入 00 或 ADR（见 §10）

---

## 3. M1 · 控制面骨架

### 3.1 任务

1. 安全组：放行 **11010 UDP+TCP、11011**；**关闭公网 6443**；9090 仅 overlay  
2. VPS 上 `easytier-core` 中枢 `10.88.0.1`  
3. k3s server：`--node-ip=10.88.0.1 --flannel-iface=easytier`  
4. PostgreSQL + `ha-api` 骨架  
5. **`ha-setup`：先 ET 再拉 payload**  
6. 打 amd64/arm64 payload，Depot 绑 10.88.0.1:9090  
7. 验收：家宽或 4G 设备 join 后 `ping 10.88.0.1`、k3s Ready  
8. 资源池按 arch 切开；节点上报虚 IP  

### 3.2 验收

- `kubectl get nodes` 的 InternalIP 为 **10.88.0.x**  
- 关闭公网 6443 后 agent 仍 Ready  
- `./ha-setup join` 在非 LAN 环境成功  
- amd64 payload 无法装进 arm64  

---

## 4. M2 · Workspace + 硬占用 + Bastion

### 4.1 任务

1. worker：用 **ha-setup** 加入 phone 或 x86，而不是手工装  
2. `ha-agent` 收编排任务  
3. `POST /workspaces`：事务扣减 → launch → 回滚路径（**arch 硬匹配**）  
4. 并发超卖测试脚本  
5. Bastion MVP：AuthorizedKeysCommand + proxy  
6. 控制台或 CLI：创建/销毁/下载 ssh config  

### 4.2 验收

- 创建 large 后池 free 减少；超卖 409  
- `ssh` 经 Bastion 进入 Workspace，可 `apt` 装包  
- 销毁后资源归还  
- 邻机（若有）隔离抽检通过（[05](05-ssh-isolation.md) §6）  

---

## 5. M3 · 用户与协作

### 5.1 任务

1. 注册/邀请/登录 JWT  
2. 项目 + 四人角色  
3. SSH 公钥管理  
4. 共享/私有 Workspace ACL  
5. audit_logs 基础查询  

### 5.2 验收

见 [04](04-collaboration.md) §9。

---

## 6. M4 · 多节点与入口

### 6.1 任务

1. 多台 agent（**至少 1×amd64 + 1×arm64 更佳**）；容量自动上报  
2. 调度：arch 过滤；phone1 拒 large 满配；mains 优先  
3. OpenResty：控制台域名；可选 IDE 反代  
4. 节点 NotReady → Workspace degraded；重建流程  
5. 账本对账 cron  

### 6.2 验收

- 两台在线时杀一台，另一台 Workspace 仍通  
- 域名可开控制台  
- 对账无持续漂移  

---

## 7. M5 · HA-1

### 7.1 任务

1. pg_dump + k3s snapshot 定时  
2. 异地拷贝  
3. 告警（进程/磁盘/备份失败）  
4. 一次完整恢复演练文档化  

### 7.2 验收

见 [08](08-ha-deployment.md) §12。

---

## 8. M6 · 增强（按需）

- Teleport 替换自研 Bastion  
- Web IDE（code-server）  
- 快照计费进账本  
- OIDC  
- Tailscale（一般不需要，已有 EasyTier）  
- 第二 `et-relay` 公网节点  
- 冷备 VPS / 托管 PG  
- Firecracker 路径实验（有 KVM 的机器）  

---

## 9. 仓库落地结构（建议）

```
ha-cluster/
├── README.md
├── docs/
├── packaging/              # ha-setup、payload 构建、.run
├── api/                    # ha-api
├── agent/                  # ha-agent
├── bastion/
├── web/                    # Refine 控制台（Vite SPA）
├── scripts/                # pack.sh、备份、超卖测试
└── deploy/
```

M1 起按需建目录；空目录不提前堆砌。

---

## 10. 开放问题（实施前拍板）

| # | 问题 | 建议默认 |
|---|------|----------|
| 1 | API / 前端用什么？ | **已拍板：Go ha-api + Refine（Vite）+ shadcn**（见 [01](01-tech-selection.md) §9） |
| 2 | Incus 还是 LXD？ | **Incus**（LXD 后继，活跃） |
| 3 | Bastion 端口 22 还是 8099？ | 看 VPS 是否已占 22；否则 22 |
| 4 | stopped 是否释放 CPU/内存？ | **不释放**（硬占用语义） |
| 5 | k3s 是否对公网开放 6443？ | **否**，只在 EasyTier |
| 10 | EasyTier 是否启用官方公共共享节点作回退？ | **默认关**；只走自家 VPS 中继 |
| 6 | 是否一期就上 Web 控制台？ | **上 Refine 台**：项目/成员走 CRUD；创建机与 Fabric 用自定义页 |
| 7 | 套餐是否允许跨节点「一台虚机」？ | **否**；一大块必须单节点装下 |
| 8 | 开发机先当 worker 还是只当 LAN Depot？ | **先 Depot**，保证手机快装；再决定是否卖容量 |
| 9 | 胖包 `.run` 还是瘦包+Depot？ | 两者都做：小白用 `.run`，日常用 `add-node`+Depot |

拍板后写入 `docs/implementation/ADR.md` 或回写 [00](00-index.md)。

---

## 11. 风险与缓解（实施向）

| 风险 | 缓解 |
|------|------|
| phone1 内存不够跑 incus+系统 | 只调度 nano/small；大套餐打标签排他 |
| npc 不稳 | **集群不再依赖 npc**；EasyTier 中继 + 心跳 |
| 开发范围膨胀 | 严守 M1：安装器能加两种 arch；M2 三角：账本+Workspace+Bastion |
| 安装靠公网现拉 | 强制 payload/Depot；CI 打冻结版本 |
| 超售偷偷回来 | 默认 strict；测试锁死 |
| 密码进库 | credentials.local + gitignore 检查 CI |

---

## 12. 第一周行动清单（可执行）

1. 在 VPS 与开发机实测 `lscpu`/`free`/`df`，回写 inventory。  
2. 拍板 §10（含开发机 Depot vs worker）。  
3. VPS 安装 easytier-core 中枢，安全组 11010/11011。  
4. 开发机与一台手机加入同一网络名，`ping 10.88.0.1`。  
5. 再打 payload / k3s（node-ip=虚 IP）。  
6. 草表 `nodes/allocations`（含 arch）。  

---

## 13. 文档维护

- 架构变更先改 implementation，再改 PRD 冲突段。  
- 设备变更只改 inventory。  
- 实施完成后把里程碑勾选更新本页。

**索引回到：[00-index.md](00-index.md)**
