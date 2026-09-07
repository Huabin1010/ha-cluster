# 05 · 隔离 SSH 环境（Workspace）

> 上级：[00-index.md](00-index.md)  
> 跳板：[06-bastion-routing.md](06-bastion-routing.md)  
> 资源：[07-resource-ledger.md](07-resource-ledger.md)

---

## 1. 目标体验

用户感觉像拿到一台 **可 SSH 的 Linux 虚拟机**：

- 独立 hostname、文件系统、进程空间、网络命名空间
- 可安装软件包、跑长进程、开多个会话
- 规格固定（如 2 核 1G），**跑满不影响邻居的硬上限**
- 不感知自己在 phone1 还是 ginkgo（除非管理员展示）

同时满足平台约束：资源已在账本占用；入口只经跳板。

---

## 2. 隔离层级

| 层 | 机制 | 效果 |
|----|------|------|
| 身份 | 平台用户 ≠ 主机 root 直登 | 必须经 Bastion ACL |
| 运行时 | Incus 系统容器（P1） | pid/mount/uts/net/ipc 隔离 |
| 资源 | cgroup v2 limits = Allocation | CPU/内存/磁盘硬顶 |
| 存储 | 每实例独立 rootfs / 卷 | 删机即清空（除非快照） |
| 网络 | 独立 veth；无公网 DNAT | 仅出站 + Bastion 入站 |
| 密钥 | 只注入授权用户公钥 | 邻居看不到私钥 |

**明确禁止的多租户做法：** 同一 Ubuntu 主机上开多个普通 user 共用一个 sshd，当作「隔离环境」。

---

## 3. Workspace 生命周期

```
requested → reserved(账本) → provisioning → running
                                ↓失败
                             failed → released
running → stopping → stopped
running → rebuilding
running/stopped → destroying → released
running → node_lost（节点失联）
```

| 状态 | 用户可做 |
|------|----------|
| running | SSH、启停服务、申请重建 |
| stopped | 开机（占用可保持或按策略释放 CPU——**推荐保持占用**，避免停机被别人买走） |
| node_lost | 重建到新节点 / 等待恢复 |
| destroyed | 不可恢复（除备份） |

### 3.1 关于「关机是否释放资源」

产品默认（与「占用不可再分」一致）：

- **stopped 仍占用 Allocation**（磁盘与规格预留）。
- 若用户要省配额，需显式 **销毁** 或「降配」（二期）。

可选管理员策略：`release_cpu_mem_on_stop=true`（释放 CPU/内存、保留磁盘占用）——须在文档与 UI 写清。

---

## 4. 创建规格与注入

### 4.1 Incus 配置映射（示例）

套餐 `large` = 4 CPU / 2Gi / 20Gi disk：

```yaml
# 逻辑配置，非最终文件名
config:
  limits.cpu: "4"
  limits.memory: 2GiB
  limits.processes: "2000"
devices:
  root:
    path: /
    pool: default
    size: 20GiB
    type: disk
```

必须与 Allocation 字段一致；禁止编排器「临时加内存」。

### 4.2 cloud-init / 首次启动

- 创建平台映射的 Linux 用户与 sudoers 策略
- 写入 `authorized_keys`
- 设置 `Hostname=ws-<shortid>`
- 可选：安装 `curl git vim`、时区 `Asia/Shanghai`
- 关闭密码登录；仅公钥
- 监听 `0.0.0.0:22` 仅在容器网；节点防火墙不暴露

### 4.3 镜像

- 基础：`ubuntu/24.04/cloud`，**与节点 arch 一致**（payload 预导入，禁止现场拉错架构）
- 预热：各 worker 提前 `incus image copy`，避免现拉
- 架构：账本套餐绑定 `arch`；**禁止**把 amd64 镜像调到 arm64 节点（反之亦然）。安装器预热对应镜像。

---

## 5. SSH 服务硬ening（容器内）

```
PasswordAuthentication no
PermitRootLogin prohibit-password   # 或无 root，仅 sudo 用户
AllowTcpForwarding no               # 默认关，防当跳板滥用；按项目可开
ClientAliveInterval 30
MaxSessions 10
```

端口固定 22（容器内）；外网映射由 Bastion 处理，用户无自定义公网口。

---

## 6. 与邻居隔离的验证清单

交付前自动化或手工：

1. A 的 Workspace 内 `ps aux` 看不到 B 的进程  
2. A 无法 mount 到 B 的 rootfs  
3. A 把内存撑到 limit 后被 cgroup OOM，B 的 ssh 仍可用  
4. A 打满 CPU 4 核配额后，B 的 CPU 用量不受明显侵占（允许调度抖动）  
5. 磁盘写满 20Gi 后写失败，不影响 B 的盘  
6. 从 A 不能直接 SSH 到 B 的地址（无路由或防火墙拒绝）

---

## 7. 真机感能力矩阵

| 能力 | P1 | 备注 |
|------|----|------|
| apt/yum 装包 | ✓ | |
| systemd 用户服务 | ✓ | 系统容器 |
| 多用户 SSH 同机 | ✓ | 协作 |
| Docker-in-Workspace | 可选 | 需额外配额与安全开关 |
| 内核模块/改内核 | ✗ | 共享宿主内核 |
| 自定义内核/KVM 嵌套 | ✗ | P3 微虚机 |
| 独立公网 IP | ✗ | 经域名/反代 |
| 快照 / 恢复 | P2 | Incus snapshot |
| 热迁移 | ✗ | 手机场景不现实；用重建 |

向用户说明：「系统容器级虚机，共享宿主内核；不是云厂商裸金属」。

---

## 8. 数据与备份

| 级别 | 策略 |
|------|------|
| 默认 | 销毁即删；提醒用户自己 git push |
| 快照 | 用户触发 `snapshot`，占额外磁盘并计账本 |
| 导出 | `incus export` 到 VPS 对象存储（配额内） |
| 节点丢失 | 本地盘可能没了 → 只能重建空机或从导出恢复 |

**持久数据不要假设能随手机迁移。**

---

## 9. 编排器接口（示意）

```
CreateWorkspace(alloc, node, image, users[]) -> instance_ref
Start/Stop/Restart(instance_ref)
Destroy(instance_ref)
Exec(instance_ref, cmd)   # 仅运维
GetSSHAddr(instance_ref) -> host, port, jump_via
Health(instance_ref) -> running|lost|degraded
```

节点侧可用 `incus` CLI/API；控制面经 **EasyTier** 调 `ha-agent`。

**推荐 P1 末引入 `ha-agent`：** 减少 API 直连 Incus 的网络复杂度，统一心跳与容量上报。

---

## 10. k3s 模式对照（非 SSH）

若项目只用 Deployment：

- 无独立 sshd；
- 隔离靠 Namespace + NetworkPolicy（能开再开）+ Quota；
- 「像虚机」体验弱；适合无状态服务。

同一账本防两模式叠加上超卖，见架构文档 §9。

下一篇：[06-bastion-routing.md](06-bastion-routing.md)
