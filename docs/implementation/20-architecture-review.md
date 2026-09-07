# 20 · 整体方案合理性审查报告

> 审查日期：2026-09-07  
> 审查范围：PRD、实施文档 00–19、全部后端 Go 代码、前端 Web 控制台、数据库 Schema  
> 结论：**方案整体设计合理、架构分层清晰、核心链路闭环完整**；但存在若干实施风险与改进空间

---

## 一、总体评价

### ✅ 做得好的地方

| 维度 | 评价 |
|------|------|
| **问题域定义** | PRD 对"分散设备、NAT 隔离、异构架构、低内存手机"等现实约束描述精准，方案不空谈理论 |
| **技术选型务实** | 放弃 KubeVirt/Firecracker 等重方案，选择 Incus 系统容器做 P1 隔离底座，完全正确 |
| **硬账本设计严谨** | `SELECT ... FOR UPDATE` 事务锁 + 先记账再拉容器 + 失败补偿释放，防超卖逻辑闭环 |
| **EasyTier Overlay 定位准确** | 用私有 Mesh 解决跨 NAT 互通，但没把平台生死绑定在上面（降级策略清晰） |
| **RBAC + 审批流** | Developer 发申请、Owner/Admin 审批，状态机 `requested → provisioning → running` 合理 |
| **文档驱动开发** | 20 份实施文档覆盖各子系统，决策可追溯，这在同类个人项目中极为少见 |

---

## 二、逐模块审查与问题清单

### 1. 宿主机资源探测（`internal/agent/host.go`）

**现状**：读取 `/proc/cpuinfo` 取 CPU 核数、`/proc/meminfo` 取 `MemTotal`，硬编码预留 800 MiB。磁盘探测缺失（心跳中默认填 `40 << 30` 即 40 GiB）。

| 级别 | 问题 | 建议 |
|------|------|------|
| 🔴 **严重** | **磁盘探测完全缺失**。`heartbeat.go` 第 45 行 `if disk == 0 { disk = 40 << 30 }` 是硬编码默认值，不反映真实磁盘。这意味着一台只有 16 GiB 存储空间的手机也会报 40 GiB 可售，导致磁盘维度的超卖。 | 必须增加基于 `syscall.Statfs` 的磁盘探测，对 Incus 存储池挂载点或 `/var/lib/incus` 进行实际采样。 |
| 🟡 **中等** | **预留内存固定为 800 MiB**，不区分设备形态。一台 3 GiB 手机预留 800 MiB 可能不够（EasyTier + Incus daemon + ha-agent 本身就要 300-500 MiB），而一台 64 GiB 服务器只预留 800 MiB 又太激进。 | 改为按设备类型差异化预留或使用百分比（如 max(800 MiB, 20%)），或由 `ha-setup` 的 `--reserve-mem` 参数显式指定。 |
| 🟡 **中等** | **`MemAvailable` 未被采集**。当前只取了 `MemTotal`，但 `MemAvailable` 是判断节点健康度的关键实时指标，在心跳中应一并上报，用于告警和降级决策。 | 在心跳中增加 `current_available_mem_bytes` 字段（只用于监控/告警，不参与账本结算）。 |
| 🟢 **轻微** | CPU 核数检测在 ARM big.LITTLE 架构上可能不准确。例如一个 4+4 大小核的 SoC，`/proc/cpuinfo` 中 `processor` 数目是 8，但性能核和能效核的算力差异很大。 | P1 暂不处理。P2 可考虑根据 `cpu_max_freq` 加权或由管理员手动覆写。 |

### 2. 硬账本与调度器（`internal/ledger/ledger.go`）

**现状**：`PickCandidateNodes` 基于内存排序的全节点列表扫描 + `Reserve` 逐一尝试候选节点。PostgreSQL 实现用 `FOR UPDATE` 行锁保证原子性。

| 级别 | 问题 | 建议 |
|------|------|------|
| 🔴 **严重** | **`PickCandidateNodes` 与 `ReserveOnNode` 之间存在 TOCTOU 竞态窗口**。`PickCandidateNodes` 读取节点容量时不加锁（`ListNodes` 是普通 SELECT），然后 `Reserve` 逐一尝试 `ReserveOnNode`（事务内加锁）。在高并发场景下，多个请求可能同时选中同一节点，只有一个能成功，其余必须回退尝试下一个。虽然重试机制存在，但如果候选节点少（如只有 2 台手机在线），**所有并发请求可能全部失败**。 | 将调度选择整合进同一个数据库事务中：`BEGIN → SELECT FROM nodes WHERE ... FOR UPDATE SKIP LOCKED → UPDATE → INSERT allocation → COMMIT`。这样利用 `SKIP LOCKED` 跳过已被其他事务锁住的行，避免串行等待。 |
| 🟡 **中等** | **调度评分模型过于简单**。当前只看 `freeMem` + 常电/P2P 加权。没有考虑节点当前负载密度、已有工作区数量（一台手机上 5 个 nano 容器 vs 1 个 medium 容器的碎片化程度很不同）、心跳延迟和稳定性历史。 | P1 可接受当前简单策略，但建议在 `scoredNode` 中加入：`容器密度`、`heartbeat RTT`、`近 24 小时在线率`。 |
| 🟡 **中等** | **`Reconcile` 对账逻辑是全表扫描**。当前实现每次 `ListAllocations` + `ListWorkspaces` 全量对比。在节点和工作区数量增长后（100+ 工作区），性能会变差。 | 短期无问题。中期建议改为增量对账：只扫描 `state != 'released'` 的 Allocation，并且引入 `last_reconciled_at` 时间戳。 |
| 🟢 **轻微** | **调度不考虑磁盘 IO 特性**。手机 eMMC 的随机写性能远低于 x86 SSD，密集 IO 型工作负载（如数据库）会严重影响手机上其他容器。 | 可以在节点标签中增加 `storage_type=emmc|ssd|hdd`，套餐可以指定 `preferred_storage`。 |

### 3. Workspace 生命周期与容器运行时（`internal/workspace/`）

**现状**：定义了 `Runtime` 接口，有 `MemoryRuntime`（测试用）和 `IncusRuntime`（生产）两种实现。`IncusRuntime` 通过 shell out 调用 `incus` CLI。

| 级别 | 问题 | 建议 |
|------|------|------|
| 🟡 **中等** | **`IncusRuntime` 运行在控制面（ha-api）上，但 Incus 安装在 worker 节点上**。当前代码 `exec.Command("incus", ...)` 假设控制面本地有 `incus` 命令并可操控远程节点，但实际上控制面（VPS）和 worker（手机/PC）是不同机器。这意味着 **当前架构需要通过 `ha-agent` 远程调用 Incus**，但 `ha-agent` 目前只有心跳上报功能，没有接收编排指令的能力。 | 这是 **P1 必须闭合的关键链路**。需要在 `ha-agent` 中增加 gRPC/HTTP 的编排指令接收接口，或者控制面通过 SSH/EasyTier 远程执行 `incus` 命令。建议优先方案：`ha-agent` 暴露 REST API（仅在 EasyTier 内网监听），接受 `Launch/Stop/Start/Destroy/Resize/InjectKeys` 请求。 |
| 🟡 **中等** | **容器创建无超时控制**。`incus launch` 如果镜像未预热，可能需要数分钟下载；但代码中没有 `context.WithTimeout`，如果网络卡住会永久阻塞。 | 给 `Launch` 加 `context.WithTimeout(ctx, 5*time.Minute)`，超时后自动清理残留容器并返回失败。 |
| 🟡 **中等** | **SSH 公钥注入有 500ms × 3 次重试**，总计最多等 1.5 秒。如果容器 cloud-init 还在初始化（安装 docker.io 等包），`/root/.ssh` 目录可能不可用。 | 增大重试间隔（如 2s × 5 次），或等待容器 cloud-init 完成信号后再注入。 |
| 🟢 **轻微** | `security.nesting=true` 默认开启（为了支持 Docker-in-Workspace），增加了攻击面。 | 改为默认关闭，仅在用户明确申请"容器嵌套"能力时开启。 |

### 4. Bastion 跳板网关（`internal/bastion/`）

**现状**：`route.go` 实现了 Workspace 地址解析逻辑（EasyTier → LAN → Breakglass 三级降级），`proxy.go` 实现了 TCP 双向字节流穿透。

| 级别 | 问题 | 建议 |
|------|------|------|
| 🔴 **严重** | **`ha-bastion-proxy` 的 `cmd/` 入口实际上尚未实现完整的 SSH 服务**。`bastion/proxy.go` 只有一个底层 TCP Dial 函数，缺少 SSH 协议层的握手、公钥认证、用户名解析 `ws-<id>` 等核心逻辑。也就是说 **Bastion 的端到端链路在代码层面还不能工作**。 | 需要用 `golang.org/x/crypto/ssh` 实现完整的 SSH Server，包括：(1) 监听端口接受连接，(2) HostKey 配置，(3) PublicKeyCallback 回调验证用户公钥，(4) 从 SSH Username 或 Channel 数据中解析目标 Workspace ID，(5) 与后端容器建立 SSH 连接并桥接。 |
| 🟡 **中等** | **`Resolve` 函数的 `actorID` 参数类型为 `bool`**。这显然不是正确的类型——应该是 `uuid.UUID` 或 `string`，用来判断用户是否是 Workspace 的 Owner。当前 `actorID == false` 的判断没有实际意义。 | 修正函数签名为 `Resolve(w Workspace, n Node, membershipRole string, actorID uuid.UUID, isAdmin bool)`，在 `VisPrivate` 分支中判断 `actorID == w.OwnerUserID`。 |
| 🟡 **中等** | **连接无超时限制**。`DialProxy` 接受 `timeout` 但只用于 Dial 阶段，后续的 `io.Copy` 没有任何超时或空闲检测。一个空闲连接会永久占用 goroutine。 | 增加 `IdleTimeout`（如 30 分钟无数据传输则关闭连接），以及全局的 `MaxSessionDuration`（如 24 小时强制断开）。 |

### 5. Ingress 泛域名与审批（`internal/ingress/`、`internal/service/ingress.go`）

**现状**：Nginx 配置渲染已实现，含 `nocache/transparent/cache` 三种预设。域名合法性校验和安全注入过滤（`SanitizeExtra`）已就绪。

| 级别 | 问题 | 建议 |
|------|------|------|
| 🟡 **中等** | **Ingress 路由缺少审批状态**。数据库 Schema（`003_ingress.sql`）中 `status` 默认为 `'active'`，没有 `pending_approval` / `rejected` 状态。这意味着当前实现是 **创建即生效**，没有管理员审批这一层。 | 修改默认 `status` 为 `'pending_approval'`，增加 `applicant_user_id`、`reviewed_by`、`reviewed_at`、`reject_reason` 字段，并在 `createIngress` API 中区分管理员直接创建（自动 active）和普通用户创建（pending_approval）。 |
| 🟡 **中等** | **缺少系统保留域名黑名单校验**。当前 `ValidDomain` 只做格式校验，不阻止用户注册 `api.apps.domain`、`admin.apps.domain` 等敏感前缀。 | 在 `createIngress` 业务逻辑中增加保留词检查：`api, admin, bastion, auth, gateway, console, vpn, system, root, login, register, health` 等。 |
| 🟢 **轻微** | **SSL 证书管理未纳入系统**。文档提到使用 ACME/Let's Encrypt 通配符证书，但代码和配置中没有自动化续签的相关集成。 | P1 可手动配置证书。P2 集成 `certbot`/`acme.sh` 自动续签 Hook。 |

### 6. 用户认证与安全（`internal/auth/`、`internal/service/extra.go`）

| 级别 | 问题 | 建议 |
|------|------|------|
| 🟡 **中等** | **JWT Access Token 有效期 15 分钟 + Refresh Token 30 天**。Access Token 15 分钟较短但合理。Refresh Token 30 天存储在数据库中，但没有绑定设备/IP，意味着泄露后可在任意设备上无限续签。 | Refresh Token 增加绑定客户端指纹（User-Agent + 部分 IP 段），或改为 7 天过期 + 滑动窗口续签。 |
| 🟡 **中等** | **`HA_JWT_SECRET` 默认值为 `"dev-insecure-change-me"`**。如果生产部署忘记修改，等同于无鉴权。 | 在 `main.go` 启动时检查：如果 JWT Secret 是默认值且非 `HA_DEV_MODE=true`，直接 panic 并打印警告。 |
| 🟢 **轻微** | **缺少登录频率限制**。当前 `Login` 接口没有防暴力破解的速率限制。 | 增加基于 IP 的登录尝试计数，5 次失败后锁定 5 分钟。 |

### 7. 数据库 Schema 与存储层

| 级别 | 问题 | 建议 |
|------|------|------|
| 🟡 **中等** | **`workspaces` 表中 `node_id UUID NOT NULL` 和 `allocation_id UUID NOT NULL` 对 `WSRequested` 状态不友好**。当工作区处于申请待审批状态（`requested`）时，还没有分配节点和 Allocation，但 Schema 要求非空。当前代码通过 `uuid.Nil`（全零 UUID）绕过，但这不是规范做法。 | 将 `node_id` 和 `allocation_id` 改为 `UUID`（可 NULL），或保持现状但在文档中明确约定全零 UUID 表示"未分配"。 |
| 🟡 **中等** | **缺少 Schema 版本管理机制**。当前用 `CREATE TABLE IF NOT EXISTS` 处理初始化，用独立 SQL 文件处理增量字段（如 `002_workspace_spec.sql`）。但没有记录已执行哪些迁移的版本表（如 `schema_migrations`），重复执行是安全的（IF NOT EXISTS），但**无法处理字段变更**（如 ALTER COLUMN）。 | 引入轻量级迁移库（如 `golang-migrate` 或 `goose`），或在 `schema_migrations` 表中记录已应用的版本号。 |
| 🟢 **轻微** | **`allocations` 表 `workspace_id` 不是外键约束**。当前定义为 `UUID` 类型但没有 `REFERENCES workspaces(id)`，可能导致一致性问题。 | 加上外键约束或在应用层保证一致性（考虑到 workspace 创建顺序，可能需要延迟约束或先插入 allocation 再更新 workspace_id）。 |

---

## 三、架构层面的系统性风险

### 风险 1：控制面单点故障（VPS 是唯一生命线）

**现状**：控制面（ha-api、PostgreSQL、Bastion、EasyTier 中枢、OpenResty）全部运行在同一台腾讯云 VPS 上。

**风险**：VPS 宕机 = 全平台不可用（API、SSH、域名全挂）。虽然文档中明确"P1 不做双控制面"，但应认识到这不是"小概率"——云厂商 VPS 的年度不可用时间在 30 分钟到数小时不等，加上安全组误操作、磁盘满、OOM 等运维事件。

**建议**：
- P1 必须做：PostgreSQL 定时备份到对象存储（已在路线图中）。
- P1 建议做：`ha-agent` 应在 EasyTier 断连后进入**自治模式**——已运行的容器不受影响，不要因为心跳失败就自动销毁工作区。
- P2 做：PostgreSQL 主从 + 第二台 VPS 做冷备切换。

### 风险 2：ha-agent 与控制面之间的编排通道未闭合

**现状**：`ha-agent` 当前只有心跳上报（`POST /nodes/heartbeat`），没有接收编排指令的能力。`IncusRuntime` 的 `exec.Command("incus", ...)` 实际只能在本机执行。

**问题**：控制面 VPS 上没有 Incus，无法直接管理远程 worker 上的容器。这是 **当前最大的功能缺口**——整个 Workspace 创建链路在跨机器场景下不能工作。

**建议方案（三选一）**：
1. **ha-agent REST API 方案（推荐）**：在 `ha-agent` 中增加 HTTP 服务（仅监听 EasyTier 接口 `10.88.0.x:9091`），接受 `POST /launch`、`POST /stop`、`POST /destroy` 等编排指令。控制面通过 EasyTier 调用 Agent API。
2. **SSH 远程执行方案**：控制面通过 EasyTier 建立到 worker 的 SSH 连接，远程执行 `incus` 命令。简单但依赖 SSH 通道可用。
3. **消息队列方案**：Agent 长轮询或 WebSocket 从 API 拉取任务。增加复杂度但对 NAT 穿透友好。

### 风险 3：手机节点的特殊脆弱性被低估

| 场景 | 影响 | 当前应对 |
|------|------|----------|
| 手机充电过夜发烫降频 | CPU 实际性能骤降至标称的 30% | 无 |
| 手机 Wi-Fi 漫游或 4G 切换 | EasyTier 隧道重建，短暂断连 | 心跳超时标 Not Ready |
| Android/Linux 内核的 OOM-Killer 杀进程 | 可能杀死 EasyTier 或 Incus daemon | 无自动恢复 |
| 手机电池循环衰减 | 突然关机 | 容器数据丢失 |

**建议**：
- 对 `power=battery` 节点增加**调度惩罚系数**（已部分实现，但权重偏小，仅 `1 << 40` 可能不够区分）。
- 对 battery 节点设置**最大容器数量上限**（如 2 个），而不是只看资源余量。
- ha-agent 应具备 watchdog 能力：检测 Incus daemon 是否存活，自动重启。

---

## 四、代码质量与工程实践

### ✅ 做得好的

1. **测试覆盖完整**：`ledger_test.go`（6757 行）、`service_test.go`、`bastion/route_test.go` 等核心模块均有严格单元测试。
2. **内存存储与 PG 存储双实现**：`store/memory` 和 `store/postgres` 确保开发与生产行为一致。
3. **模型层定义清晰**：`models.go` 中状态常量、角色权限判断函数结构好。
4. **审计日志贯穿全链路**：几乎每个关键操作（登录、创建项目、创建工作区、审批、销毁）都有 audit log。

### ⚠️ 需改进的

1. **错误处理不够精细**：很多地方直接返回 `store.ErrInvalidInput` 或 `store.ErrNoCapacity`，缺少上下文信息。建议使用 `fmt.Errorf("create workspace %s: %w", name, err)` 包装错误链。
2. **日志缺失**：整个代码库没有使用 `log` 或结构化日志库（如 `slog`）。生产部署后将无法排查问题。
3. **配置管理零散**：大量硬编码的默认值分散在各模块中（如 `defaultJWTSecret`、`disk = 40 << 30`、`reserve = 800 MiB`）。建议统一到一个 `config` 包或 `config.yaml` 中。

---

## 五、文档与方案的一致性检查

| 文档描述 | 代码实现 | 一致性 |
|---------|----------|--------|
| 硬账本防超卖 + 事务锁 | `postgres.go` `ReserveOnNode` 使用 `FOR UPDATE` | ✅ 一致 |
| 先记账再创建，失败回滚 | `service.go` `provisionNewWorkspace` 失败调 `Release` | ✅ 一致 |
| 架构硬匹配（amd64 不上 arm64） | `PickCandidateNodes` 过滤 `arch` | ✅ 一致 |
| 常电优先于电池调度 | `score += 1 << 40` for mains | ✅ 一致 |
| 申请需审批（Developer 提交，Owner 批准） | `CreateWorkspace` 根据 `CanApproveWorkspace` 分流 | ✅ 一致 |
| SSH 公钥注入到容器 | `incus.go` `injectKeys` 写入 `authorized_keys` | ✅ 一致 |
| Bastion 三级降级（Fabric→LAN→Breakglass） | `route.go` `Resolve` 逐级判断 | ✅ 一致 |
| 磁盘探测（Statfs） | `host.go` **缺失**，默认 40 GiB | ❌ 不一致 |
| 域名审批流（pending_approval → active） | `003_ingress.sql` 默认 `'active'`，无审批状态 | ❌ 不一致 |
| Bastion SSH 完整服务 | `cmd/ha-bastion-proxy/` 尚未实现 SSH 协议层 | ❌ 不一致 |
| ha-agent 接收编排指令 | `internal/agent/` 仅有心跳上报 | ❌ 不一致 |

---

## 六、与同类方案的横向对比

| 维度 | ha-cluster | Coolify | Dokku | 自建 k3s |
|------|-----------|---------|-------|---------|
| **异构支持** | ✅ amd64+arm64 并存 | 部分 | 不支持 | 需手动 |
| **NAT 穿透** | ✅ EasyTier Mesh | 不内置 | 不支持 | 需 WireGuard |
| **硬资源占用** | ✅ 严格账本 | 无 | 无 | 靠 ResourceQuota |
| **SSH 真机感** | ✅ 系统容器 | Docker exec | Docker exec | Pod exec |
| **轻量级** | ✅ 单二进制 Go | Node.js | Bash + Heroku | 较重 |
| **成熟度** | 🟡 开发中 | 🟢 生产可用 | 🟢 成熟 | 🟢 成熟 |

**结论**：ha-cluster 在"异构边缘设备 + NAT 穿透 + 真机感隔离"这个交叉场景下，没有直接竞品。技术方向正确。

---

## 七、优先级排序的改进建议清单

### P0（阻塞上线，必须修复）

1. **实现 ha-agent 编排指令接收**——否则跨机器创建容器不可用。
2. **实现磁盘探测**——否则磁盘维度账本无意义。
3. **完成 ha-bastion-proxy SSH 协议层**——否则 SSH 不可达。

### P1（上线前应完成）

4. 修复 `bastion/route.go` 中 `actorID` 参数类型错误。
5. Ingress 增加 `pending_approval` 审批状态与保留词黑名单。
6. 容器创建增加超时控制。
7. 预留内存改为可配置（至少支持环境变量覆写）。
8. 增加结构化日志（至少 `slog`）。
9. JWT Secret 启动时安全检查。

### P2（上线后迭代）

10. 调度器引入 `SKIP LOCKED` 优化并发。
11. Refresh Token 绑定设备指纹。
12. Schema 迁移工具集成。
13. `security.nesting=true` 改为可选。
14. 登录速率限制。
15. battery 节点容器数量上限。

---

## 八、最终结论

**方案整体架构合理，技术选型务实，核心设计思路（硬账本 + Incus 隔离 + EasyTier Mesh + Bastion 跳板）完全正确。** 文档体系完整度在个人项目中罕见，RBAC 与审计设计也为后续多租户扩展留足了空间。

主要风险集中在 **"设计到代码"的最后一公里**：ha-agent 的编排指令接收、Bastion 的 SSH 协议实现、磁盘探测这三个关键链路尚未闭合。这些是阻塞真实部署的硬缺口，建议作为下一阶段的首要开发任务。

其余问题（竞态优化、日志、安全加固、审批流补全）属于工程质量提升，可以在核心链路打通后有序推进。
