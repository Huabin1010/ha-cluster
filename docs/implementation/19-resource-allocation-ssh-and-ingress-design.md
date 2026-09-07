# 19 · 宿主机资源纳管、项目规格申请、SSH 极速信任与泛域名审批落地架构方案

> 上级索引：[00-index.md](00-index.md)  
> 深入落地规范：[21-core-pipeline-spec.md](21-core-pipeline-spec.md)（含 Agent 编排 RPC 协议、真实磁盘 Statfs、Bastion 原生 SSH 协议及 Ingress 审批闭环）  
> 适用组件：`ha-agent`、`ha-api`、`ha-setup`、`ha-bastion-proxy`、`web` 控制台  
> 文档性质：**端到端核心功能架构设计与工程实施指南**

---

## 目录

- [1. 方案目标与背景](#1-方案目标与背景)
- [2. 宿主机可用资源获取与纳管（核、内存、硬盘）](#2-宿主机可用资源获取与纳管核内存硬盘)
  - [2.1 物理硬件探测（Raw Metrics）](#21-物理硬件探测raw-metrics)
  - [2.2 双层安全预留机制（System & HA Reserved）](#22-双层安全预留机制system--ha-reserved)
  - [2.3 动态心跳上报与硬账本（Hard Ledger）结算](#23-动态心跳上报与硬账本hard-ledger结算)
  - [2.4 异构特性与算力池分类（amd64 / arm64 / 电池）](#24-异构特性与算力池分类amd64--arm64--电池)
- [3. 基于项目的资源配额申请与审批工作流](#3-基于项目的资源配额申请与审批工作流)
  - [3.1 多租户模型与预算额度（Project Budget）](#31-多租户模型与预算额度project-budget)
  - [3.2 预设套餐与自定义规格](#32-预设套餐与自定义规格)
  - [3.3 角色权限与工单审批流（RBAC & Approval Flow）](#33-角色权限与工单审批流rbac--approval-flow)
  - [3.4 防超卖原子扣减算法与调度事务](#34-防超卖原子扣减算法与调度事务)
- [4. 极速 SSH 访问与公钥信任体系](#4-极速-ssh-访问与公钥信任体系)
  - [4.1 用户公钥集中纳管与格式校验](#41-用户公钥集中纳管与格式校验)
  - [4.2 容器创建与运行时公钥注入（Zero-Touch Provisioning）](#42-容器创建与运行时公钥注入zero-touch-provisioning)
  - [4.3 Bastion 跳板网关（ha-bastion-proxy）穿透架构](#43-bastion-跳板网关ha-bastion-proxy穿透架构)
  - [4.4 用户端极致体验：一键命令与 SSH Config 导出](#44-用户端极致体验一键命令与-ssh-config-导出)
- [5. 泛域名解析提供与申请审批体系](#5-泛域名解析提供与申请审批体系)
  - [5.1 泛域名（Wildcard DNS）与自动化通配符 SSL 证书](#51-泛域名wildcard-dns与自动化通配符-ssl-证书)
  - [5.2 虚拟网络穿透代理链路（Overlay Ingress Routing）](#52-虚拟网络穿透代理链路overlay-ingress-routing)
  - [5.3 域名申请与管理员审批流程（安全防撞车机制）](#53-域名申请与管理员审批流程安全防撞车机制)
  - [5.4 Nginx 配置安全渲染与无感热重载（Hot-Reload）](#54-nginx-配置安全渲染与无感热重载hot-reload)
- [6. 整体系统时序与数据流全景图](#6-整体系统时序与数据流全景图)
- [7. 数据库表结构与字段扩展设计](#7-数据库表结构与字段扩展设计)
- [8. 实施路径与工程落地检查清单（Checklist）](#8-实施路径与工程落地检查清单checklist)

---

## 1. 方案目标与背景

`ha-cluster` 定位于面向边缘算力、闲置 PC、刷机 Linux 手机与 VPS 云主机的**轻量级异构调度与真机感 Workspace 管理平台**。在实际运维和开发者协作过程中，存在四个紧密交织的核心需求：

1. **资源精准感知**：一台新设备（无论是 32C/64G 的 x86 工作站，还是 8C/3G 内存的旧 ARM 手机）配置入网后，系统必须能准确探测出它的 CPU 物理核心、真实可用内存与磁盘空间，并剔除系统与平台自身开销，避免超售引发连锁 OOM。
2. **规范化按需申请**：开发者不能无节制索取资源，需按“项目（Project）”提交机器规格申请（核数、内存、硬盘）；普通成员提交申请需经由项目主管或平台管理员审批核准后，系统才在硬账本中锁定容量并拉起容器。
3. **极速 SSH 直达**：容器拉起后，无需开发者在内网打洞或手动配置端口映射，其 SSH 公钥自动下发并在秒级建立信任；通过控制面统一的 Bastion 跳板，一条命令直接连接目标真机容器。
4. **统一泛域名暴露与审批**：对于容器内运行的 Web 服务，平台需提供统一的公网泛域名（如 `*.apps.yourdomain.com`）解析与自动 SSL 证书，但子域名路由必须经过审批，杜绝端口混乱与域名劫持。

---

## 2. 宿主机可用资源获取与纳管（核、内存、硬盘）

### 2.1 物理硬件探测（Raw Metrics）

在宿主机上运行的 `ha-agent` 和初始化接入脚本 `ha-setup` 是物理感知的第一道防线。探测方式遵循标准 Linux 内核接口，兼容不同架构体系：

1. **CPU 核心探测**：
   - 读取 `/proc/cpuinfo` 中的 `processor` 条目数，或调用 Go 原生 `runtime.NumCPU()` 获取有效逻辑核心数。
   - 换算单位为毫核（`milliCPU`）：$1 \text{ Core} = 1000 \text{ milliCPU}$。
   - 探测系统当前 CPU 架构：`amd64` (x86_64) 或 `arm64` (aarch64)。
2. **内存探测**：
   - 读取 `/proc/meminfo` 中的 `MemTotal`（单位 KiB），得到物理总内存大小。
   - 读取 `MemAvailable`（非 MemFree，包含 Buffers/Cached 中可快速回收部分）作为节点健康参考。
3. **硬盘空间探测**：
   - 工作区的容器存储挂载点通常位于 Incus 存储池（如 `/var/lib/incus/storage-pools/default` 或 `/var/lib/ha-agent/data`）。
   - 通过系统调用 `unix.Statfs` / `syscall.Statfs` 针对容器存储所在挂载目录进行采样：
     $$\text{DiskTotal} = \text{Blocks} \times \text{Bsize}$$
     $$\text{DiskAvailable} = \text{Bavail} \times \text{Bsize} \quad \text{（以非 root 可用块为准）}$$

### 2.2 双层安全预留机制（System & HA Reserved）

严禁直接将物理硬件总量（Raw Capacity）当作可售配额（Allocatable Capacity）。平台执行**双层扣减规则**：

```
┌─────────────────────────────────────────────────────────────┐
│ 物理总硬件 (Raw Capacity: CPU, MemTotal, DiskTotal)          │
└──────────────────────────────┬──────────────────────────────┘
                               │
            - 系统预留 (System Reserved: 内核, systemd, 桌面环境)
                               │
            - 平台预留 (HA Reserved: easytier, incusd, ha-agent)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 最终可售核定容量 (Allocatable Capacity)                       │
│ Allocatable = Raw - SystemReserved - HAReserved             │
└─────────────────────────────────────────────────────────────┘
```

#### 具体扣减参数表

| 设备形态 | 物理内存基线 | 系统与平台预留 | 实际可售内存 (Allocatable) | 策略原因 |
|---|---|---|---|---|
| **Linux 手机 (ARM64)** | 3 GiB | 预留 ~1.0 GiB | **~2.0 GiB** | 电池供电，低内存极易被 Linux OOM-Killer 杀死关键网络进程 |
| **Linux 手机 (ARM64)** | 4 GiB | 预留 ~1.0 GiB | **~3.0 GiB** | 预留 EasyTier Mesh 隧道与 Incus 运行时 |
| **x86 开发者工作站** | 32 GiB | 预留 ~8.0 GiB | **~24.0 GiB** | 需保障宿主机原有桌面环境、IDE 与浏览器流畅运行 |
| **专用服务器/无桌面** | 64 GiB | 预留 ~2.0 GiB | **~62.0 GiB** | 纯粹算力节点，仅保留系统核心守护进程 |

> **配置自定义**：在 `ha-setup` 执行初始化时，支持传入配置或参数覆写，例如 `--reserve-mem 4G` 或在 `/etc/ha-cluster/agent.env` 中指定：
> ```bash
> HA_NODE_NAME="node-x86-workstation"
> HA_RESERVED_MEM_MB=8192
> HA_RESERVED_CPU_MILLI=2000
> HA_CUSTOM_POOL="pool-amd64-mains"
> ```

### 2.3 动态心跳上报与硬账本（Hard Ledger）结算

平台采用**“静态核定可售容量，动态硬账本扣减分配”**的结算模型，彻底避免资源超配：

1. **心跳上报协议（Heartbeat）**：
   - `ha-agent` 每 15 秒向中心 `ha-api` 发送心跳数据 `POST /nodes/heartbeat`：
     ```json
     {
       "name": "node-pc-01",
       "arch": "amd64",
       "class": "desktop",
       "power": "mains",
       "fabric_ip": "10.88.0.12",
       "allocatable_cpu_milli": 6000,
       "allocatable_mem_bytes": 25769803776,
       "allocatable_disk_bytes": 214748364800,
       "fabric_path": "p2p",
       "fabric_rtt_ms": 2
     }
     ```
2. **硬账本严格原子扣除（Hard Ledger）**：
   - **核心设计哲学**：**剩余可用资源不等于宿主机当前实时剩余内存！** 因为已创建的容器刚启动时可能只占 200MB，但申请了 2GB；若按实时剩余内存售卖，后续容器一旦负载上升必然导致宿主机 OOM。
   - **计算公式**：
     $$\text{RemainingMem} = \text{AllocatableMem} - \sum_{\text{Allocation.State} \in \{\text{reserved, active}\}} \text{Allocation.MemBytes}$$
   - 即使容器处于 `stopped` 挂载待机状态，其预占配额依然被算作硬占用，只有被彻底删除销毁（Destroy）后，状态变更为 `released`，配额才回退回可用池。

### 2.4 异构特性与算力池分类（amd64 / arm64 / 电池）

不同硬件平台的架构与供电差异显著，严禁混池调度：
- `pool-amd64-mains`：x86 架构有源供电，适合重型编译、Node/Java 服务。
- `pool-arm64-mains`：如树莓派、开发板等常电 ARM 算力。
- `pool-arm64-battery`：旧手机改造成的 ARM 算力。此类节点带有电池衰减风险，调度器默认采用**节能且防过载**的单容器安置策略。

---

## 3. 基于项目的资源配额申请与审批工作流

### 3.1 多租户模型与预算额度（Project Budget）

系统构建自上而下的三层组织架构：
1. **平台层（Platform）**：平台全局管理宿主机池、节点接入与系统审计。
2. **项目层（Project）**：资源核算的最小边界。每个项目均有管理员设定的资源配额上限（`Project Budget`）：
   - `BudgetCPUMilli`：项目最多可使用的核数（如 8000m）。
   - `BudgetMemBytes`：项目最多可申请的内存总量（如 16 GiB）。
   - `BudgetDiskBytes`：项目最多可申请的磁盘空间（如 100 GiB）。
3. **工作区层（Workspace）**：具体运行在某台宿主机 Incus 实例中的独立 Linux 环境。

### 3.2 预设套餐与自定义规格

系统既支持标准化快速套餐，也支持在项目配额范围内的自定义配额：

```go
// 标准套餐预设列表
"nano":   {CPU: 500m,   Mem: 256 MiB, Disk: 5 GiB}    // 适合小型网关或心跳探测
"small":  {CPU: 1000m,  Mem: 512 MiB, Disk: 10 GiB}   // 适合 Go/Rust 单微服务
"2c2g":   {CPU: 2000m,  Mem: 2048 MiB, Disk: 5 GiB}   // 适合通用开发容器
"medium": {CPU: 2000m,  Mem: 1024 MiB, Disk: 15 GiB}  // 适合常规后端 API
"large":  {CPU: 4000m,  Mem: 2048 MiB, Disk: 20 GiB}  // 适合并发测试环境
"xlarge": {CPU: 6000m,  Mem: 3072 MiB, Disk: 30 GiB}  // 适合内存型轻负载
```

- **自定义规格（Custom Spec）**：用户可在前端界面直接拖动滑块或输入具体的 CPU 核数、内存容量及磁盘容量。系统通过 `models.ValidSpec()` 进行边界约束检查（最少 100m/64MiB/1GiB，最大 32C/64GiB/500GiB）。

### 3.3 角色权限与工单审批流（RBAC & Approval Flow）

```
[Developer 开发者] ──发起申请──► [生成 WSRequested 工单]
                                       │
                                       ▼
                         [Project Owner / Platform Admin]
                                  /         \
                            [驳回 Reject]   [批准 Approve]
                                 │                │
                        [更新为 WSRejected]  [事务锁账本 + 选机调度]
                                                  │
                                                  ▼
                                         [生成 Allocation 记录]
                                                  │
                                                  ▼
                                         [Agent 拉起 Incus 容器]
                                                  │
                                                  ▼
                                         [更新为 WSRunning]
```

- **角色权限控制**：
  - `Developer`（普通开发者）：只能提交工作区创建申请，工作区初始状态进入 `WSRequested`。
  - `Admin / Owner`（项目管理员/负责人）：具有审批权限（`CanApproveWorkspace`）。
  - `Platform Admin`（平台超管）：拥有全局特权，审批或直接创建均可秒级生效。
- **超限阻断**：当申请规格加上项目当前活跃资源总量超过 `Project Budget` 时，前端直接标红预警，后端在校验接口直接返回 `400 Bad Request (Budget Exceeded)`。

### 3.4 防超卖原子扣减算法与调度事务

为杜绝并发申请导致宿主机超售，调度与分配严格在数据库事务中通过**排他锁（Pessimistic Row Lock）**执行：

```sql
BEGIN;

-- 1. 根据请求的 Arch 和资源需求，锁定候选节点
SELECT id, allocatable_cpu_milli, allocatable_mem_bytes, allocatable_disk_bytes,
       used_cpu_milli, used_mem_bytes, used_disk_bytes
FROM nodes
WHERE ready = true 
  AND (arch = $requested_arch OR $requested_arch = 'any')
  AND (allocatable_cpu_milli - used_cpu_milli) >= $req_cpu
  AND (allocatable_mem_bytes - used_mem_bytes) >= $req_mem
  AND (allocatable_disk_bytes - used_disk_bytes) >= $req_disk
ORDER BY 
  power DESC, -- 常电优先于电池设备
  (allocatable_mem_bytes - used_mem_bytes) DESC -- 剩余空间最大优先调度
LIMIT 1
FOR UPDATE;

-- 2. 扣减节点已用计数
UPDATE nodes
SET used_cpu_milli  = used_cpu_milli  + $req_cpu,
    used_mem_bytes  = used_mem_bytes  + $req_mem,
    used_disk_bytes = used_disk_bytes + $req_disk
WHERE id = $selected_node_id;

-- 3. 写入硬账本记录 (Allocation)
INSERT INTO allocations (id, workspace_id, project_id, node_id, cpu_milli, mem_bytes, disk_bytes, state, created_at)
VALUES ($alloc_id, $ws_id, $project_id, $selected_node_id, $req_cpu, $req_mem, $req_disk, 'active', NOW());

-- 4. 提交事务
COMMIT;
```

---

## 4. 极速 SSH 访问与公钥信任体系

### 4.1 用户公钥集中纳管与格式校验

用户在使用平台前，只需在 Web 个人设置中录入一次公钥：

1. **导入与解析**：
   - 支持解析标准 OpenSSH 格式公钥（`ssh-ed25519`、`ecdsa-sha2-nistp256`、`ssh-rsa` 等）。
   - 系统利用 Go `golang.org/x/crypto/ssh` 原生库解析公钥内容，并自动提取或计算出指纹（SHA256 Fingerprint），例如：
     `SHA256:abc123456789... user@laptop`。
2. **项目级共享信任**：
   - 区分工作区可见性：
     - `private`（个人私有）：仅注入工作区创建者的 SSH 公钥。
     - `shared`（项目共享）：自动合并当前项目内所有具有 `Developer` 及以上角色的成员公钥，实现结对编程和团队共享排查。

### 4.2 容器创建与运行时公钥注入（Zero-Touch Provisioning）

在节点创建容器时，实现无需手动登录的零接触（Zero-Touch）自动信任：

```
[ha-api / 控制面]
       │
       ▼ 下发包含公钥列表的创建请求 (NodeID, WSConfig, PublicKeys[])
[ha-agent / 宿主机]
       │
       ├─► 1. 调用 Incus API 创建并配置容器 (限制 cgroup cpu/mem)
       │
       ├─► 2. Cloud-init / 磁盘挂载写入:
       │      /root/.ssh/authorized_keys
       │      /home/workspace/.ssh/authorized_keys
       │
       └─► 3. 修正权限: chmod 700 .ssh && chmod 600 authorized_keys
```

- **公钥动态热同步**：当用户在控制台新增或移除 SSH Key 时，控制面异步广播至该用户拥有工作区所在的 `ha-agent`，Agent 自动覆写容器内的 `authorized_keys`，变更在 1 秒内生效，**无需重启工作区**。

### 4.3 Bastion 跳板网关（ha-bastion-proxy）穿透架构

由于各宿主机分散在家用宽带或移动网络中（无公网 IP），外部用户无法直连容器。平台在公网控制面部署专属轻量 SSH 跳板网关 `ha-bastion-proxy`（监听端口如 `:2222`）。

```
                                  公网 VPS 入口
                               ┌────────────────────────────────┐
                               │ ha-bastion-proxy (:2222)       │
                               │ - 验证用户身份与公钥           │
                               │ - 解析目标 Workspace ID        │
                               └───────────────┬────────────────┘
                                               │
                                 EasyTier 虚拟内网 (10.88.0.x)
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               ▼                                                               ▼
     [宿主机 A (x86)]                                                [宿主机 B (ARM 手机)]
     EasyTier: 10.88.0.10                                            EasyTier: 10.88.0.11
     ┌────────────────────────────┐                                  ┌────────────────────────────┐
     │ Incus 容器 (ws-frontend)   │                                  │ Incus 容器 (ws-backend)    │
     │ SSH: :22 (映射至随机端口)  │                                  │ SSH: :22                   │
     └────────────────────────────┘                                  └────────────────────────────┘
```

#### 连接过程解析

1. **统一连接命令**：用户使用如下标准命令连接：
   ```bash
   ssh -p 2222 ws-<workspace_id>@bastion.yourdomain.com
   ```
2. **握手与路由判定**：
   - 客户端与 `ha-bastion-proxy` 完成 SSH 握手并提供公钥。
   - Bastion 从用户名中提取目标 Workspace ID（`ws-<uuid>`）。
   - Bastion 向控制面校验：**出示此公钥的用户是否有权访问该 Workspace？**
   - 校验通过后，Bastion 查询该 Workspace 所在的宿主机 EasyTier 内网 IP（如 `10.88.0.10`）及其暴露的 SSH 端口。
3. **TCP 字节流透明穿透**：
   - Bastion 在内存中通过 `net.Dial` 连通内部宿主机容器的 SSH 服务，并将两端的 SSH 原始加密流（`io.Copy`）双向打通。
   - 端到端依然保持为**用户终端与容器内部原生 sshd 之间的原始公钥协商**，Bastion 不解密载荷，保证绝对安全与极低延迟。

### 4.4 用户端极致体验：一键命令与 SSH Config 导出

在 Web 控制台的 Workspace 卡片与详情页上，直接为用户提供即开即用的连接选项：

1. **一键连接命令**（点击复制）：
   ```bash
   ssh -p 2222 ws-07b1f3c8@bastion.yourdomain.com
   ```
2. **一键导出 `~/.ssh/config` 配置块**：
   ```ssh-config
   Host my-cluster-node
       HostName bastion.yourdomain.com
       Port 2222
       User ws-07b1f3c8
       IdentityFile ~/.ssh/id_ed25519
       ServerAliveInterval 30
   ```
   *用户将其粘贴至本机 `~/.ssh/config` 后，在 VS Code Remote-SSH 或本地终端中输入 `ssh my-cluster-node` 即可实现一键直连！*
3. **Web 端免密终端（Web Terminal）**：
   - 控制台基于 `xterm.js` + `WebSocket` 提供内嵌浏览器终端，即使用户在移动设备或无 SSH 客户端的电脑上，也能在网页上秒开 Shell 体验。

---

## 5. 泛域名解析提供与申请审批体系

### 5.1 泛域名（Wildcard DNS）与自动化通配符 SSL 证书

为了让工作区内的 HTTP/HTTPS 服务（如 Web 站点、API 接口、在线调试面板）轻松对公网开放，平台在控制面构筑了泛域名 Ingress 体系：

1. **公网 DNS 泛解析配置**：
   - 平台管理员将一个主域名（如 `*.apps.yourdomain.com`）的 **A 记录** 解析至控制面公网 VPS 的 IP 地址（`HA_INGRESS_PUBLIC_IP`）。
   - 只要解析生效，任何形如 `foo.apps.yourdomain.com` 或 `bar.apps.yourdomain.com` 的请求都会自动路由到控制面 VPS。
2. **自动化通配符 SSL 证书（ACME / Let's Encrypt）**：
   - 在控制面通过 `certbot` 或 `acme.sh` 配合 DNS 提供商（如 Cloudflare, DNSPod, 阿里云）的 API Token，申请通配符证书：
     - 域名保护范围：`*.apps.yourdomain.com` 与 `apps.yourdomain.com`。
   - 证书自动续签并挂载至控制面的 Nginx / OpenResty。
   - **效果**：所有用户后续申请的任意合法子域名，均**出厂自带绿色有效 HTTPS 证书**，无需用户单独配置证书。

### 5.2 虚拟网络穿透代理链路（Overlay Ingress Routing）

当公网用户访问 `https://demo.apps.yourdomain.com` 时，流量路径如下：

```
[公网访客]
    │ HTTPS (:443)
    ▼
[控制面公网 VPS / OpenResty]
    │ 匹配 ServerName: demo.apps.yourdomain.com
    │ 终止 SSL，根据 Ingress 规则反向代理至 Upstream
    │
    │ (流量进入 EasyTier Mesh 虚拟网络，直达目标内网节点)
    ▼
[目标宿主机 (EasyTier: 10.88.0.15)]
    │
    ▼ 容器目标服务 (例如 Node.js 监听 8080)
[Workspace 内部进程]
```

### 5.3 域名申请与管理员审批流程（安全防撞车机制）

泛域名虽便捷，但必须防止**恶意占用系统保留前缀**（如 `admin`、`api`、`login`）、**同名冲突（域名撞车）**以及**未授权对外暴露**。因此必须实施严格的申请与审批流程：

```
[用户在 Workspace 页面点击“申请公网域名”]
                  │
                  ▼
[前端校验与填写: 期望前缀, 容器内部端口, 路由预设]
                  │
                  ▼
[后端业务校验: 敏感词过滤, 全局唯一性检查, 端口合法性]
                  │
                  ▼
[写入 ingress_routes 表 (Status = 'pending_approval')]
                  │
                  ├───────────────────────────────┐
                  ▼                               ▼
       [管理员后台: 审批通过]               [管理员后台: 驳回]
                  │                               │
                  ▼                               ▼
        [Status = 'active']             [Status = 'rejected']
                  │
                  ▼
   [渲染 Nginx 配置文件并热重载生效]
                  │
                  ▼
      [通知用户: 域名已上线可用]
```

#### 安全防御与校验规则

1. **系统保留词黑名单（Reserved Keywords）**：
   - 拒绝注册前缀：`api`、`bastion`、`auth`、`admin`、`gateway`、`root`、`system`、`console`、`vpn` 等。
2. **全局排他性冲突检测**：
   - 查询全库中的 `ingress_routes`，确保申请的前缀 `domain` 处于未占用状态。
3. **安全注入防御**：
   - 严格使用 `ingress.SanitizeExtra()` 过滤用户填写的 Nginx 自定义规则，严禁包含 `}`、`include`、`server` 等破坏主配置的危险指令。

### 5.4 Nginx 配置安全渲染与无感热重载（Hot-Reload）

审批通过后，控制面即刻触发无感平滑配置加载：

1. **配置文件独立隔离**：
   - 每个生效的 Ingress 路由在 `/etc/nginx/ha-ingress.d/` 目录下生成一个专属的 `.conf` 文件，命名为 `<route_id>.conf`。
2. **基于预设的精细化模板配置**：
   - `nocache`（默认）：针对开发调试场景，强制 `Cache-Control: no-store`，支持长连接超时 3600 秒。
   - `transparent`：针对 WebSocket、开发热重载（HMR）以及长轮询应用，开启 `proxy_buffering off`。
   - `cache`：针对生产静态站，开启 1 分钟短缓存优化吞吐。
3. **原子安全重载（Safe Reload）**：
   ```bash
   # 1. 验证配置文件语法有效性，避免错误配置弄崩主服务
   nginx -t -q
   # 2. 验证成功后执行平滑加载，现有连接不断流
   nginx -s reload
   ```

---

## 6. 整体系统时序与数据流全景图

以下为从“宿主机纳管”到“用户申请机器”、“SSH 连接”及“域名上线”的完整时序图：

```
[宿主机 Agent]      [控制面 API]       [管理员/Owner]       [普通开发者]        [公网访客/SSH]
      │                 │                  │                  │                 │
      ├─1.心跳上报硬件───►│                  │                  │                 │
      │  (核/内存/硬盘)  ├─写入节点台账      │                  │                 │
      │                 │                  │                  │                 │
      │                 │◄──2.登记 SSH 公钥───────────────────┤                 │
      │                 │                  │                  │                 │
      │                 │◄──3.发起申请机器────────────────────┤                 │
      │                 │   (选套餐/填规格) │                  │                 │
      │                 ├─生成待审批工单───►│                  │                 │
      │                 │                  │                  │                 │
      │                 │◄─4.审核同意(Approve)                 │                 │
      │                 ├─开启事务锁账本    │                  │                 │
      │                 ├─扣减 Allocatable │                  │                 │
      │◄─5.RPC下发创建───┤                  │                  │                 │
      ├─Incus 启动容器  │                  │                  │                 │
      ├─注入 SSH 公钥   │                  │                  │                 │
      ├─回报 Running────►├─状态更新 Running─────────────────►通知就绪           │
      │                 │                                     │                 │
      │                 │◄──6.申请域名(foo.apps.domain:8080)──┤                 │
      │                 ├─生成域名工单─────►│                  │                 │
      │                 │◄─7.同意域名上线───┤                  │                 │
      │                 ├─写入 Nginx 配置并 reload             │                 │
      │                 │                                     │                 │
      │                 │◄──────────8. 发起 SSH 访问 (Port 2222)────────────────┤
      │◄─EasyTier 穿透隧道─┼─Bastion 鉴权公钥并直连 Workspace ───────────────────┤
      │                 │                                                       │
      │                 │◄──────────9. HTTP(S) 访问 foo.apps.domain ────────────┤
      │◄─EasyTier 代理转发─┼─Nginx 终止 SSL 并反代到容器端口 ─────────────────────┤
```

---

## 7. 数据库表结构与字段扩展设计

为支撑上述完整流转，数据库关键表设计如下：

### 1. 节点表（`nodes`）与容量

```sql
CREATE TABLE nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL UNIQUE,
    arch VARCHAR(16) NOT NULL,            -- amd64 / arm64
    class VARCHAR(32) NOT NULL,           -- desktop / phone / server
    power VARCHAR(16) NOT NULL,           -- mains (常电) / battery (电池)
    role VARCHAR(16) NOT NULL,            -- worker / control
    fabric_ip VARCHAR(64) NOT NULL,       -- EasyTier 内网 IP (如 10.88.0.x)
    lan_ip VARCHAR(64),
    
    -- 核定可售容量 (已扣除系统与平台预留)
    allocatable_cpu_milli BIGINT NOT NULL,
    allocatable_mem_bytes BIGINT NOT NULL,
    allocatable_disk_bytes BIGINT NOT NULL,
    
    -- 当前硬占用计数
    used_cpu_milli BIGINT NOT NULL DEFAULT 0,
    used_mem_bytes BIGINT NOT NULL DEFAULT 0,
    used_disk_bytes BIGINT NOT NULL DEFAULT 0,
    
    ready BOOLEAN NOT NULL DEFAULT false,
    last_heartbeat TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2. 硬账本分配表（`allocations`）

```sql
CREATE TABLE allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    project_id UUID NOT NULL,
    node_id UUID NOT NULL REFERENCES nodes(id),
    cpu_milli BIGINT NOT NULL,
    mem_bytes BIGINT NOT NULL,
    disk_bytes BIGINT NOT NULL,
    arch VARCHAR(16) NOT NULL,
    state VARCHAR(16) NOT NULL,          -- reserved / active / released
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at TIMESTAMPTZ
);
CREATE INDEX idx_alloc_node_state ON allocations(node_id, state);
```

### 3. 工作区表（`workspaces`）与申请状态

```sql
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    name VARCHAR(64) NOT NULL,
    plan VARCHAR(32) NOT NULL,           -- nano / 2c2g / custom
    arch VARCHAR(16) NOT NULL,
    visibility VARCHAR(16) NOT NULL DEFAULT 'shared', -- shared / private
    owner_user_id UUID NOT NULL REFERENCES users(id),
    node_id UUID REFERENCES nodes(id),
    allocation_id UUID REFERENCES allocations(id),
    status VARCHAR(32) NOT NULL,         -- requested / provisioning / running / stopped / failed / rejected
    
    -- 申请的硬规格
    cpu_milli BIGINT NOT NULL,
    mem_bytes BIGINT NOT NULL,
    disk_bytes BIGINT NOT NULL,
    
    ssh_port INT NOT NULL DEFAULT 22,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4. 泛域名路由与审批表（`ingress_routes`）

```sql
CREATE TABLE ingress_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id),
    domain VARCHAR(253) NOT NULL UNIQUE, -- 如 demo.apps.yourdomain.com
    path VARCHAR(128) NOT NULL DEFAULT '/',
    port INT NOT NULL,                   -- 容器内部服务监听端口 (如 8080)
    preset VARCHAR(32) NOT NULL DEFAULT 'nocache', -- nocache / transparent / cache
    extra_nginx TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_approval', -- pending_approval / active / rejected
    nginx_preview TEXT,
    dns_hint TEXT,
    applicant_user_id UUID NOT NULL REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    reject_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 8. 实施路径与工程落地检查清单（Checklist）

### 第一阶段：宿主机资源与硬账本自动化（P1）
- [x] 在 `internal/agent/host.go` 实现内核 `MemTotal`、`processor` 探测与挂载磁盘 `Statfs` 探测。
- [x] 在 `internal/agent/heartbeat.go` 完善节点心跳上报协议。
- [x] 在 `internal/ledger/ledger.go` 实现原子化 `SELECT FOR UPDATE` 资源排他锁与扣减。
- [ ] 扩展 `ha-setup` 支持 `--reserve-mem`、`--reserve-cpu` 引导参数，并固化至宿主机环境配置。

### 第二阶段：用户项目申请与审批工作流（P1）
- [x] 建立 `models.WSRequested`、`models.WSProvisioning`、`models.WSRunning` 状态机。
- [x] 实现 `CanApproveWorkspace` 基于角色的鉴权校验。
- [ ] 在 Web 控制台添加“资源申请工单”面板，提供审批“同意”与“驳回”操作按钮。
- [ ] 在项目详情页直观展示项目资源预算进度条（已用 CPU / 最大配额，已用内存 / 最大配额）。

### 第三阶段：极速 SSH 访问与公钥体系（P1）
- [x] 用户中心公钥录入、OpenSSH 格式校验与 SHA256 指纹生成。
- [x] 容器初始化时由 Agent 将公钥写入容器 `authorized_keys`。
- [x] `ha-bastion-proxy` 基于 EasyTier 内网进行端口隧道穿透。
- [ ] 在 Web 控制台提供一键复制 `ssh -p 2222 ws-xxx@host` 与一键导出 `~/.ssh/config` 模态弹窗。

### 第四阶段：泛域名解析与申请审批闭环（P2）
- [x] 统一配置公共 DNS 泛解析 `*.apps.yourdomain.com` 至公网 VPS。
- [x] 通过 ACME 统一签发 `*.apps.yourdomain.com` 通配符 SSL 证书。
- [x] 实现 `internal/ingress/nginx.go` 配置安全渲染与敏感指令校验。
- [ ] 在 API 与 Web 控制台增加域名申请审批流（`pending_approval` $\rightarrow$ `active` / `rejected`）。
- [ ] 审批通过触发 `nginx -s reload` 平滑生效并回显公网直达超链接。
