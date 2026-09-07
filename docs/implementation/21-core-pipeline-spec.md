# 21 · 核心链路闭环设计与工程规范

> 上级索引：[00-index.md](00-index.md)  
> 关联审查：[20-architecture-review.md](20-architecture-review.md)  
> 适用组件：`ha-agent`、`ha-api`、`ha-bastion-proxy`、`internal/workspace`、`internal/ingress`  
> 文档性质：**填补 3 个 P0 级工程缺失与 1 个审批闭环的详细接口与实现标准规范**

---

## 目录

- [1. 概述与解决的核心问题](#1-概述与解决的核心问题)
- [2. ha-agent 远程编排协议规范（填补 P0 缺口 1）](#2-ha-agent-远程编排协议规范填补-p0-缺口-1)
  - [2.1 架构与网络拓扑（EasyTier 内网 RPC）](#21-架构与网络拓扑easytier-内网-rpc)
  - [2.2 接口定义（RESTful API on Worker）](#22-接口定义restful-api-on-worker)
  - [2.3 鉴权与安全通道（双向 Token 认证）](#23-鉴权与安全通道双向-token-认证)
  - [2.4 控制面 RemoteIncusRuntime 实现契约](#24-控制面-remoteincusruntime-实现契约)
  - [2.5 超时重试与故障补偿机制](#25-超时重试与故障补偿机制)
- [3. 真实磁盘动态探测设计规范（填补 P0 缺口 2）](#3-真实磁盘动态探测设计规范填补-p0-缺口-2)
  - [3.1 Linux Syscall Statfs 探测原理](#31-linux-syscall-statfs-探测原理)
  - [3.2 存储池路径判定（Incus Pool vs Rootfs）](#32-存储池路径判定incus-pool-vs-rootfs)
  - [3.3 磁盘系统预留与防爆盘安全水线](#33-磁盘系统预留与防爆盘安全水线)
  - [3.4 代码实现与心跳契约集成](#34-代码实现与心跳契约集成)
- [4. ha-bastion-proxy SSH 协议层完整实现规范（填补 P0 缺口 3）](#4-ha-bastion-proxy-ssh-协议层完整实现规范填补-p0-缺口-3)
  - [4.1 SSH 服务端架构（crypto/ssh）](#41-ssh-服务端架构cryptossh)
  - [4.2 用户名解析与路由提取算法](#42-用户名解析与路由提取算法)
  - [4.3 PublicKeyCallback 动态鉴权流水线](#43-publickeycallback-动态鉴权流水线)
  - [4.4 终端通道协商（PTY + Shell）与原始 TCP 桥接](#44-终端通道协商pty--shell与原始-tcp-桥接)
  - [4.5 空闲超时（Idle Timeout）与会话审计落地](#45-空闲超时idle-timeout与会话审计落地)
- [5. 泛域名审批工作流与安全黑名单规范（填补业务闭环）](#5-泛域名审批工作流与安全黑名单规范填补业务闭环)
  - [5.1 数据库字段与状态机改造](#51-数据库字段与状态机改造)
  - [5.2 系统保留词黑名单规则清单](#52-系统保留词黑名单规则清单)
  - [5.3 审批流接口契约（申请、审批、驳回）](#53-审批流接口契约申请审批驳回)
  - [5.4 审批通过后 Nginx 热重载触发器](#54-审批通过后-nginx-热重载触发器)
- [6. 变更检查清单与落地验收标准](#6-变更检查清单与落地验收标准)

---

## 1. 概述与解决的核心问题

在审查报告（[20-architecture-review.md](20-architecture-review.md)）中，指出了系统上线必须攻克的**三个 P0 级严重缺失**和**一个业务流闭环缺口**：

1. **跨节点容器编排链路断裂**：控制面在 VPS，Incus 运行在边缘异构主机，控制面本地执行 `incus` 命令无法驱动异构主机。
2. **磁盘容量虚假上报**：节点心跳默认写死 40 GiB，小容量手机存在被超额售卖击穿闪存的严重风险。
3. **Bastion 跳板网关协议层未就绪**：只有底层 TCP 拨号，缺少 SSH Server 协议解析、公钥回调校验、路由拦截与终端转发。
4. **域名路由缺乏审批状态机**：创建即直接生效，无 `pending_approval` 状态和管理员审核接口，缺乏保留前缀黑名单。

本文档给出这四大模块的**精确工程规范、协议契约、数据结构与关键伪代码**。

---

## 2. ha-agent 远程编排协议规范（填补 P0 缺口 1）

### 2.1 架构与网络拓扑（EasyTier 内网 RPC）

控制面 `ha-api` 不能把各 Worker 的 SSH 暴露在公网，也不能假设控制面机器装有远程 Incus 证书。解决方案是：**在 `ha-agent` 内部集成轻量 HTTP API 守护模块，仅监听该节点的 EasyTier 虚拟网 IP**。

```
[控制面 VPS: ha-api]
       │
       │ (基于 EasyTier Mesh 内网，HTTPS/HTTP POST 请求)
       │ URL: http://10.88.0.x:9091/v1/...
       │ Header: X-HA-Node-Token: <NodeSecret>
       ▼
[Worker 节点: ha-agent 守护进程 (监听 10.88.0.x:9091)]
       │
       ├─► 本地调用 Incus CLI / Incus Unix Socket (/var/lib/incus/unix.socket)
       ├─► 磁盘与进程资源配置 (limits.cpu, limits.memory, limits.disk)
       ├─► 注入 /root/.ssh/authorized_keys
       └─► 返回执行结果与容器状态
```

### 2.2 接口定义（RESTful API on Worker）

Agent 默认监听端口：`:9091`（必须严格绑定在 `n.FabricIP`，严禁绑定 `0.0.0.0`）。

#### 1) 启动/创建工作区：`POST /v1/workspaces/launch`

- **请求头**：`X-HA-Node-Token: <token>`
- **请求体（JSON）**：
  ```json
  {
    "workspace_id": "07b1f3c8-1111-2222-3333-444455556666",
    "name": "ws-demo",
    "image": "images:ubuntu/24.04",
    "cpu_milli": 2000,
    "mem_bytes": 2147483648,
    "disk_bytes": 10737418240,
    "ssh_keys": [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@desktop"
    ],
    "enable_nesting": false
  }
  ```
- **响应体（JSON）**：
  ```json
  {
    "code": 0,
    "message": "success",
    "data": {
      "workspace_id": "07b1f3c8-1111-2222-3333-444455556666",
      "instance_name": "ha-07b1f3c8",
      "ssh_port": 22,
      "host_key_fp": "SHA256:abcd...",
      "status": "running"
    }
  }
  ```

#### 2) 停止工作区：`POST /v1/workspaces/stop`

- **请求体**：`{"workspace_id": "uuid", "force": true}`
- **响应**：`{"code": 0, "message": "stopped"}`

#### 3) 启动工作区：`POST /v1/workspaces/start`

- **请求体**：`{"workspace_id": "uuid"}`
- **响应**：`{"code": 0, "message": "started"}`

#### 4) 销毁工作区：`POST /v1/workspaces/destroy`

- **请求体**：`{"workspace_id": "uuid", "force": true}`
- **逻辑**：强制 `incus stop` 并 `incus delete`，清理关联临时卷与云配置。
- **响应**：`{"code": 0, "message": "destroyed"}`

#### 5) 热更新配置：`POST /v1/workspaces/resize`

- **请求体**：
  ```json
  {
    "workspace_id": "uuid",
    "cpu_milli": 4000,
    "mem_bytes": 4294967296,
    "disk_bytes": 21474836480
  }
  ```
- **响应**：`{"code": 0, "message": "resized"}`

#### 6) 动态热推公钥：`POST /v1/workspaces/sync-keys`

- **请求体**：
  ```json
  {
    "workspace_id": "uuid",
    "ssh_keys": [
      "ssh-ed25519 AAA...",
      "ssh-rsa AAA..."
    ]
  }
  ```
- **逻辑**：不重启容器，直接通过 `incus file push` 覆写目标容器内的 `authorized_keys` 并纠正权限 `chmod 600`。

### 2.3 鉴权与安全通道（双向 Token 认证）

1. **预共享 Node Token**：
   - 节点加入集群时，`ha-setup` 会分配唯一的节点凭证（`HA_NODE_TOKEN`），存入宿主机 `/etc/ha-cluster/agent.env`。
   - 控制面在数据库 `nodes` 表保存该 Token 的哈希值或加密密文。
2. **鉴权校验**：
   - Agent 服务对每次传入的 HTTP 请求校验 Header `X-HA-Node-Token`。
   - 匹配失败立即返回 `401 Unauthorized` 并记录安全日志。
3. **网络层隔离保护**：
   - Agent 的 HTTP Server 启动参数必须配置为：
     ```go
     addr := net.JoinHostPort(cfg.FabricIP, "9091")
     server := &http.Server{Addr: addr, Handler: router}
     ```
   - 保证公网流量无法物理触达该端口。

### 2.4 控制面 RemoteIncusRuntime 实现契约

在控制面，重构 `internal/workspace/runtime.go`，将当前的单机 `IncusRuntime` 替换为面向网络的 `RemoteIncusRuntime`：

```go
type RemoteIncusRuntime struct {
    Client  *http.Client
    Timeout time.Duration
}

func (r *RemoteIncusRuntime) Launch(ctx context.Context, w models.Workspace, node models.Node, sshKeys []string) (Instance, error) {
    if node.FabricIP == "" {
        return Instance{}, fmt.Errorf("node %s has no fabric IP", node.Name)
    }
    url := fmt.Sprintf("http://%s:9091/v1/workspaces/launch", node.FabricIP)
    
    // 构造载荷并附带 5 分钟总超时（包含拉镜像）
    ctxTimeout, cancel := context.WithTimeout(ctx, 5*time.Minute)
    defer cancel()
    
    // 发送 HTTP POST 请求...
}
```

### 2.5 超时重试与故障补偿机制

1. **镜像预加载**：`ha-setup` 在安装节点时，预先从 Depot 导入基础 Ubuntu 镜像（`incus image import`），杜绝运行时从外网拉取的超时问题。
2. **补偿释放机制**：
   - 如果远程 Agent 在 5 分钟内超时或返回非 0 错误，控制面执行回滚：
     1. 调用 `RemoteIncusRuntime.Destroy(ctx, w.ID)` 防止孤儿子容器残留。
     2. 调用 `Ledger.Release(ctx, alloc.ID)` 释放已占用的资源。
     3. 工作区状态置为 `WSFailed`。

---

## 3. 真实磁盘动态探测设计规范（填补 P0 缺口 2）

### 3.1 Linux Syscall Statfs 探测原理

必须抛弃写死的 `40 << 30`，采用 Linux 内核标准系统调用 `syscall.Statfs`：

```go
package agent

import (
    "golang.org/x/sys/unix"
)

type DiskUsage struct {
    TotalBytes     uint64 `json:"total_bytes"`
    AvailableBytes uint64 `json:"available_bytes"`
    FreeBytes      uint64 `json:"free_bytes"`
}

func GetDiskUsage(path string) (DiskUsage, error) {
    var stat unix.Statfs_t
    err := unix.Statfs(path, &stat)
    if err != nil {
        return DiskUsage{}, err
    }

    // 块大小 * 块数 = 字节数
    bsize := uint64(stat.Bsize)
    total := stat.Blocks * bsize
    // Bavail 是非特权用户（非 root）可分配块数
    avail := stat.Bavail * bsize
    free := stat.Bfree * bsize

    return DiskUsage{
        TotalBytes:     total,
        AvailableBytes: avail,
        FreeBytes:      free,
    }, nil
}
```

### 3.2 存储池路径判定（Incus Pool vs Rootfs）

Incus 存储池可能配置在不同路径或独立文件系统（ZFS/Btrfs/LVM/Dir）：

1. **优先级 1（显式指定）**：环境变量 `HA_STORAGE_PATH`（若配置则首选，如 `/var/lib/ha-cluster/data`）。
2. **优先级 2（Incus 默认池路径）**：`/var/lib/incus/storage-pools/default`。
3. **优先级 3（降级回退）**：根目录 `/`（通用 Linux 容器默认挂载点）。

### 3.3 磁盘系统预留与防爆盘安全水线

闪存（尤其是手机 eMMC）一旦被写满会导致 Linux 内核 panic、数据库损坏或无法开机。平台必须执行**硬防爆盘水线**：

1. **固定系统预留（Disk Reserve）**：
   - 基础预留：默认预留 **至少 4 GiB**（用于内核系统更新、systemd journal 日志、EasyTier 运行日志）。
   - 百分比预留：预留物理磁盘的 **15%**。
   - 实际预留值：$\text{DiskReserve} = \max(4\text{ GiB}, \text{DiskTotal} \times 15\%)$。
2. **可售磁盘核定公式（Allocatable Disk）**：
   $$\text{AllocatableDisk} = \max(0, \text{DiskAvailable} - \text{DiskReserve})$$
   *当可用磁盘不足 5 GiB 时，该节点上报可售磁盘为 0，停止接纳任何新容器。*

### 3.4 代码实现与心跳契约集成

在 `internal/agent/host.go` 中集成探测：

```go
func HostDiskCapacity(storagePath string) (totalBytes, allocatableBytes int64) {
    if storagePath == "" {
        storagePath = "/var/lib/incus"
        if _, err := os.Stat(storagePath); os.IsNotExist(err) {
            storagePath = "/"
        }
    }
    u, err := GetDiskUsage(storagePath)
    if err != nil {
        return 0, 0
    }
    
    // 扣除预留
    reserve := uint64(4 * 1024 * 1024 * 1024) // 4 GiB
    pctReserve := u.TotalBytes * 15 / 100      // 15%
    if pctReserve > reserve {
        reserve = pctReserve
    }
    
    var allocatable int64 = 0
    if u.AvailableBytes > reserve {
        allocatable = int64(u.AvailableBytes - reserve)
    }
    return int64(u.TotalBytes), allocatable
}
```

在心跳上报 `internal/agent/heartbeat.go` 中，将真实的 `allocatable` 赋值给 `Status.AllocatableDisk`，彻底清除硬编码。

---

## 4. ha-bastion-proxy SSH 协议层完整实现规范（填补 P0 缺口 3）

### 4.1 SSH 服务端架构（crypto/ssh）

在 `cmd/ha-bastion-proxy/main.go` 中必须启动原生的 SSH 守护进程：

```
客户端 (SSH Client)
       │
       │ 1. 建立 TCP 连接 (默认端口 :2222 或 :8099)
       ▼
ha-bastion-proxy (ssh.ServerConfig)
       │
       ├─► 2. PublicKeyCallback: 查询控制面校验公钥与用户状态
       ├─► 3. 解析目标路由: 从 Username (ws-<id>) 或 SSH Command 中解析目标
       ├─► 4. ACL 鉴权: 判定用户是否有权进入该 Workspace (CanSSH)
       ├─► 5. 寻址: 调取目标 Workspace 所在宿主机的 FabricIP:SSHPort
       │
       ▼ 6. 透传穿透 (net.Dial("tcp", "10.88.0.x:22"))
目标宿主机 Incus 容器内 sshd
```

### 4.2 用户名解析与路由提取算法

支持两种用户连接模式：

1. **直接目标格式（推荐）**：
   ```bash
   ssh -p 8099 ws-07b1f3c8@bastion.domain.com
   ```
   - 提取用户名 `ws-07b1f3c8`，前缀 `ws-` 标明直接指定了 Workspace ID 前缀。
2. **交互选择/参数透传格式**：
   ```bash
   ssh -p 8099 alice@bastion.domain.com -t ws-07b1f3c8
   ```
   - 用户名为平台用户名 `alice`，从 SSH Channel 的 `exec` 或 `pty-req` 请求中获取目标工作区标识。

### 4.3 PublicKeyCallback 动态鉴权流水线

在 SSH 握手阶段完成用户与工作区的权限绑定：

```go
config := &ssh.ServerConfig{
    PublicKeyCallback: func(conn ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
        fp := ssh.FingerprintSHA256(key)
        username := conn.User()
        
        // 1. 调用内部控制面 API 查询此公钥绑定的 User
        user, err := authClient.LookupUserByPublicKey(fp)
        if err != nil {
            return nil, fmt.Errorf("unknown or unauthorized key")
        }
        
        // 2. 将鉴权成功的用户信息存入 Permissions.Extensions
        return &ssh.Permissions{
            Extensions: map[string]string{
                "user_id":   user.ID.String(),
                "username":  user.Username,
                "role":      user.PlatformRole,
                "key_fp":    fp,
            },
        }, nil
    },
}
```

### 4.4 终端通道协商（PTY + Shell）与原始 TCP 桥接

在 SSH Channel 建立后，跳板网关执行透明管道桥接：

```go
// 针对 SSH 会话通道 (channelType == "session")
func handleSessionChannel(newChannel ssh.NewChannel, perms *ssh.Permissions, target Target) {
    channel, requests, err := newChannel.Accept()
    if err != nil {
        return
    }
    defer channel.Close()

    // 拨号通往 EasyTier 内网目标
    backendConn, err := net.DialTimeout("tcp", net.JoinHostPort(target.Host, strconv.Itoa(target.Port)), 5*time.Second)
    if err != nil {
        channel.Write([]byte("Error: Target workspace is unreachable.\r\n"))
        return
    }
    defer backendConn.Close()

    // 双向转发原始字节流
    errc := make(chan error, 2)
    go func() { _, e := io.Copy(backendConn, channel); errc <- e }()
    go func() { _, e := io.Copy(channel, backendConn); errc <- e }()
    <-errc
}
```

### 4.5 空闲超时（Idle Timeout）与会话审计落地

1. **防死连接挂死（Timeout Wrapper）**：
   - 在双向 Copy 过程中使用带有 Deadline 的连接包装器（`IdleTimeoutConn`），当连接连续 **30 分钟无字节传输**时主动断开连接，释放系统句柄。
   - 单次会话设定硬上限（如最长 24 小时）。
2. **审计日志写入（Audit Stream）**：
   - 握手成功时向控制面 POST `/audit`：`{"action": "ssh.session.open", "user_id": ..., "workspace_id": ..., "client_ip": ...}`。
   - 会话结束时触发：`{"action": "ssh.session.close", "duration_seconds": ...}`。

---

## 5. 泛域名审批工作流与安全黑名单规范（填补业务闭环）

### 5.1 数据库字段与状态机改造

将当前直接生效的 Ingress 流程升级为带有审批流的合规流程：

```sql
-- 数据库表升级脚本 (004_ingress_approval.sql)
ALTER TABLE ingress_routes 
  ALTER COLUMN status SET DEFAULT 'pending_approval';

ALTER TABLE ingress_routes 
  ADD COLUMN IF NOT EXISTS applicant_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT DEFAULT '';
```

#### 状态机模型

```
[用户申请] ──► [pending_approval] ──┬──► [管理员批准] ──► [active (渲染 Nginx 配置)]
                                   │
                                   └──► [管理员驳回] ──► [rejected (记录原因)]
```

### 5.2 系统保留词黑名单规则清单

严禁用户注册可能导致系统钓鱼、路由冲突或撞车的域名。在 `internal/ingress/validator.go` 中实施阻断：

```go
var ReservedSubdomains = map[string]struct{}{
    "admin": {}, "api": {}, "auth": {}, "bastion": {}, "console": {},
    "control": {}, "dashboard": {}, "depot": {}, "dns": {}, "docs": {},
    "gateway": {}, "git": {}, "grafana": {}, "health": {}, "login": {},
    "logout": {}, "mail": {}, "monitor": {}, "ops": {}, "prometheus": {},
    "proxy": {}, "register": {}, "root": {}, "signup": {}, "status": {},
    "system": {}, "vpn": {}, "web": {}, "ws": {},
}

func IsSubdomainReserved(subdomain string) bool {
    lower := strings.ToLower(strings.TrimSpace(subdomain))
    _, ok := ReservedSubdomains[lower]
    return ok
}
```

### 5.3 审批流接口契约（申请、审批、驳回）

#### 1) 提交申请（普通用户/开发者）

- **URL**：`POST /workspaces/{id}/ingress`
- **处理规则**：
  - 如果请求者角色为 `platform_admin` 或项目 `owner`，状态直接设为 `active` 并生效。
  - 普通成员提交，校验保留词和唯一性后，状态设为 `pending_approval`，记录 `applicant_user_id`。

#### 2) 审批通过（管理员/Owner）

- **URL**：`POST /ingress/{id}/approve`
- **鉴权**：必须具有 `CanApproveWorkspace` 权限。
- **业务操作**：
  1. 更新 `status = 'active'`, `reviewed_by = actor.ID`, `reviewed_at = NOW()`。
  2. 触发控制面调用 `rewriteIngress()` 写入专属 `.conf` 文件。
  3. 执行 Nginx 安全热重载。

#### 3) 驳回申请（管理员/Owner）

- **URL**：`POST /ingress/{id}/reject`
- **请求体**：`{"reason": "域名与业务线命名规范冲突"}`
- **业务操作**：
  1. 更新 `status = 'rejected'`, `reject_reason = ...`。
  2. 记录审计日志，不向 Nginx 生成任何配置文件。

### 5.4 审批通过后 Nginx 热重载触发器

确保每次审批通过时无感生效：

```go
func (a *App) ApproveIngress(ctx context.Context, actor models.User, routeID uuid.UUID) (*models.IngressRoute, error) {
    r, err := a.Store.GetIngress(ctx, routeID)
    if err != nil {
        return nil, err
    }
    if _, err := a.RequireMembership(ctx, actor, r.ProjectID, models.RoleAdmin); err != nil {
        return nil, store.ErrForbidden
    }
    
    r.Status = models.IngressActive
    now := time.Now()
    r.ReviewedBy = &actor.ID
    r.ReviewedAt = &now
    
    if err := a.Store.UpdateIngress(ctx, r); err != nil {
        return nil, err
    }
    
    // 重新生成配置文件并平滑重载
    a.rewriteIngress(ctx)
    
    return r, nil
}
```

---

## 6. 变更检查清单与落地验收标准

| 模块 | 关键任务 | 验证方式 | 负责人 |
|---|---|---|---|
| **ha-agent** | 监听 EasyTier 虚 IP `:9091` 并支持 launch/stop/destroy/sync-keys | 本地 `curl -H "X-HA-Node-Token:..." http://10.88.0.x:9091/v1/workspaces/launch` 成功创建容器 | T4 |
| **磁盘探测** | 在 `host.go` 中集成 `Statfs`，心跳上报真实可售磁盘（扣除 15% 预留） | 检查控制面数据库 `nodes` 表中 `allocatable_disk_bytes` 与主机 `df -B1` 吻合 | T4 |
| **Bastion** | 基于 `golang.org/x/crypto/ssh` 实现 SSH 握手、公钥校验与 Raw TCP 转发 | 执行 `ssh -p 8099 ws-<uuid>@bastion.domain` 成功进入容器 Shell | T5 |
| **Ingress 审批** | 增加 `pending_approval` 状态与保留词拦截，管理员批准后生成 Nginx 配置 | 用户申请保留词被拒；申请合法子域名需审批后 `https://<subdomain>.apps...` 正常访问 | T1 |
