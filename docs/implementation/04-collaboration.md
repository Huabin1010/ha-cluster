# 04 · 多用户协作

> 上级：[00-index.md](00-index.md)  
> 用户基础：[03-user-management.md](03-user-management.md)

---

## 1. 协作要解决什么

多人共用同一套分散算力时，需要：

1. **同一项目下共享配额与 Workspace**（而不是每人偷偷 SSH 进同一台手机）。
2. **权限分级**：观者不能删机，开发者不能改计费。
3. **并行不互相踩**：默认同项目可共享一台 Workspace，也支持每人私有 Workspace。
4. **资源仍硬占用**：加人协作**不会**让配额变魔术变多；只是共享已买下的切片。

---

## 2. 协作单元

```
Organization（可选二期）
  └── Project（一期主边界）
        ├── Members（RBAC）
        ├── Budget / Allocations（账本）
        ├── Workspaces[]
        ├── Secrets / 配置（可选）
        └── Domains / 入口规则（可选）
```

一期以 **Project** 为唯一协作边界；Organization 留表字段即可。

### 2.1 项目可见性（硬规则）

- **非成员看不见项目**：未加入的用户，`GET /projects` 列表不含该项目；直链 `GET /projects/{id}` 返回 **404**（不泄露存在）。
- 接受邀请后 `membership` 生效，侧栏才出现该项目。
- 成员进入项目后，仍可能 **无 SSH 权** 或 **只读 SSH**；见 [30-project-member-access.md](30-project-member-access.md)。

---

## 3. 协作模式

### 3.1 共享 Workspace（默认友好）

- 项目内一台 `ws-shared`，所有 `developer+` 用自己的 SSH 公钥经跳板进入**同一**环境。
- 适合结对调试、共用运行中的服务。
- 风险：文件系统互相可见；靠 Linux 用户分离可增强（见下）。

**增强（推荐）：** Workspace 内每平台用户映射为 Linux 用户：

| 平台用户 | 容器内用户 | sudo |
|----------|------------|------|
| alice (owner) | alice | 可 |
| bob (developer) | bob | 可或按项目策略 |
| carol (viewer) | 无 shell | — |

共享仍在同一 mount namespace；敏感目录可用 ACL/独立 home。

### 3.2 私有 Workspace

- `ws-alice-dev`、`ws-bob-dev`：创建时 `visibility=private`，仅本人 + owner/admin。
- 各占各自 Allocation；项目可设「私有机总额度」。

### 3.3 混合

同一项目：1 台共享 staging + N 台私有 dev。账本按总和占用。

---

## 4. 成员与邀请流

### 4.1 主路径：添加同事（下拉选角色）

团队内同事已注册平台账号时，**直接添加**，无需邮件：

```
owner / admin → 成员页「添加成员」
  → 搜索选择用户（用户名 / 邮箱）
  → 角色下拉：admin | developer | viewer
  → POST /projects/{id}/members { user_id, role }
  → membership 立即生效 + audit_log
```

- **`admin`**：委派审批权（创建/升配/降配/SSH 初审；销毁仅初审，终审在平台）。
- **`developer` / `viewer`**：普通成员。
- owner 转让后 **原 owner 降为 `developer`**，见 [22](22-project-machine-concepts.md) §5.3。

### 4.2 次要路径：邮件邀请（未注册用户）

```
owner/admin → POST /projects/{id}/invitations { email, role }
  → 邮件或链接 token（单次、限时）
invitee 注册/登录 → accept → membership 生效
```

邀请表单同样使用 **角色下拉**，与 §4.1 选项一致。

移除成员时：

1. 立刻撤销其 Bastion ACL 与 API 权限；
2. 其**私有** Workspace：可选转让给 owner 或限时销毁；
3. **共享** Workspace：删除其 Linux 用户与授权密钥，不销毁实例；
4. 不自动释放别人的 Allocation。

---

## 5. 协作功能清单

| 功能 | P1 | P2 |
|------|----|----|
| 邀请/移除成员、改角色 | ✓ | |
| 项目活动流（谁创建了机） | ✓ | |
| 共享与私有 Workspace | ✓ | |
| 项目级环境变量/Secret 注入 | | ✓ |
| 共享磁盘（NFS/MinIO mount） | | ✓ |
| 在线多人终端（结对） | | ✓ |
| Issue / 简单看板 | | 可选 |
| Git 集成（推送部署） | | ✓ |
| 资源用量报表按成员 | ✓ 基础 | ✓ 精细 |

---

## 6. 冲突与约定

### 6.1 谁也不能超卖

协作 UI 必须展示：

- 项目已占用 / 项目预算
- 集群池剩余（可对普通用户只显示「是否还能创建」）

创建按钮在不足时禁用，并返回 `409 INSUFFICIENT_CAPACITY`。

### 6.2 并发创建

使用 DB 事务 + 项目级预算行锁（`SELECT … FOR UPDATE`），避免两人同时点「新建」各扣一次导致超卖。

### 6.3 配置冲突

共享 Workspace 内包版本冲突：平台不仲裁；建议：

- 文档约定「共享机只跑集成，开发在私有机」；
- 或提供「一键快照/重建」。

---

## 7. kubeconfig / 部署协作

对启用 k8s 模式的项目：

- 成员下载**命名空间范围** kubeconfig（ServiceAccount + RoleBinding）。
- `viewer` 只读 Role；`developer` edit；禁止 cluster-admin。
- 与 Workspace SSH 权限独立配置，但默认与项目角色对齐。

---

## 8. 通知（轻量）

MVP：控制台铃铛 + 邮件（邀请、Workspace 失败、节点丢失）。  
不做复杂 IM，可留 Webhook。

---

## 9. 验收场景

1. Alice 建项目并邀请 Bob 为 developer；Carol 为 viewer。  
2. Bob 能创建 Workspace；Carol 不能。  
3. Bob、Alice 都能 SSH 进共享机；Carol 被 Bastion 拒绝。  
4. 项目预算仅剩 0.5Gi 时，Bob 创建 1Gi 失败，Alice 也不能例外（除非 admin 改预算且池有余量）。  
5. 移除 Bob 后，其 SSH 立即失败；共享机仍在。

下一篇：[05-ssh-isolation.md](05-ssh-isolation.md)
