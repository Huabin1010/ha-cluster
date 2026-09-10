# 30 · 项目可见性与成员细粒度访问

> 上级索引：[00-index.md](00-index.md)  
> 关联：[03-user-management.md](03-user-management.md)、[04-collaboration.md](04-collaboration.md)、[24-ssh-access-and-approval.md](24-ssh-access-and-approval.md)、[22-project-machine-concepts.md](22-project-machine-concepts.md)  
> 文档性质：**成员能否看见项目、能否 SSH、SSH 只读/读写** 定稿

---

## 1. 原则

1. **非成员看不见项目** — 未加入某 Project 的用户，列表、搜索、直链 URL 均 **不得** 暴露该项目存在（返回空列表或 `404`，不泄露名称/成员数）。
2. **进项目 ≠ 能 SSH** — 已是成员，仍可能 **无连接权**（`ssh_access=none`），只能看控制台只读信息或走申请流。
3. **SSH 可分级** — 已授予连接权时，管理员可设为 **只读 Shell**（能看文件、不能改）或 **读写 Shell**（默认）。

---

## 2. 项目可见性（第一层）

```
用户请求项目资源
  → 校验 memberships(project_id, user_id)
  → 无记录：拒绝（列表不出现；GET /projects/{id} → 404）
  → 有记录：按角色 + 下文 SSH 维度继续
```

| 场景 | 行为 |
|------|------|
| `GET /projects` | 仅返回 **本人为成员** 的项目（`ListProjectsForUser`） |
| `GET /projects/{id}` | 非成员 → **404**（不用 403，避免泄露项目存在） |
| 子资源 `/projects/{id}/workspaces` 等 | 同上，非成员 404 |
| `platform_admin` | 可列全部项目（运维）；须审计 |

邀请未接受前：用户 **不是** 成员，**看不到** 项目；接受邀请后 `membership` 生效，项目出现在侧栏。

---

## 3. 成员在项目内能做什么（第二层）

在 **已是成员** 的前提下，能力由 **项目角色（role）** 与 **SSH 两字段** 共同决定：

| 维度 | 字段 | 取值 |
|------|------|------|
| 协作角色 | `membership.role` | `owner` / `admin` / `developer` / `viewer` |
| 能否连 SSH | `membership.ssh_access` | `none` / `pending` / `granted` / `revoked` |
| SSH 能力级别 | `membership.ssh_mode` | `read_write`（默认）/ `read_only`（仅当 `ssh_access=granted`） |

### 3.1 角色 × 控制台能力（与 SSH 无关部分）

| 能力 | owner | admin | developer | viewer |
|------|-------|-------|-----------|--------|
| 看项目设置 / 成员 | ✓ | ✓ | ✗ | ✗ |
| 看工作区列表与用量 | ✓ | ✓ | ✓ | ✓（只读） |
| 申请新机器 | ✓ 免审 | ✓ 免审 | ✓ 须审批 | ✗ |
| 审批创建 / 升配 / 降配 / SSH | ✓ | ✓ | ✗ | ✗ |
| 销毁机器 **初审** | ✓ | ✓ | ✗ | ✗ |
| 销毁机器 **终审** | ✗ | ✗ | ✗ | ✗（仅 `platform_admin` 或委派平台角色，见 29 §8） |
| 管成员 SSH 权 | ✓ | ✓ | ✗ | ✗ |

### 3.2 SSH 连接权（第三层）

即使角色是 `developer`，若 `ssh_access=none`，也 **不能** SSH：

| `ssh_access` | 控制台 | Bastion |
|--------------|--------|---------|
| `none` | 无「一键 SSH」；可申请 | 拒绝 |
| `pending` | 显示「审批中」 | 拒绝 |
| `revoked` | 显示「已撤销」；可再申请 | 拒绝 |
| `granted` | 显示 SSH 入口（见 `ssh_mode`） | 在 ACL 通过时允许 |

**默认策略（推荐）：**

| 邀请角色 | `ssh_access` 初值 | `ssh_mode` 初值 |
|----------|-------------------|-----------------|
| `owner` / `admin` | `granted` | `read_write` |
| `developer` | `none`（或项目策略 `granted`） | `read_write` |
| `viewer` | `none` | —（无 granted 时不适用） |

owner/admin 审批 SSH 申请时可 **同时指定** `ssh_mode`（只读观察员 vs 可改代码）。

### 3.3 SSH 模式：只读 vs 读写

当 `ssh_access=granted` 时：

| `ssh_mode` | 用户体验 | 技术要点（实现） |
|------------|----------|------------------|
| `read_write` | 正常 shell，可改文件、装包（在配额内） | 默认 Linux 用户 + 正常 `authorized_keys` |
| `read_only` | 可 `ls`/`cat`/`less`，**不能** 写工作区文件、不能 `sudo`、不能改系统 | 见 §5 |

控制台文案：

- 读写：`一键 SSH`
- 只读：`只读 SSH（不可修改文件）`

---

## 4. 完整判定链（工作区 SSH）

```
允许进入 workspace W 的 SSH 会话 iff
  ① 用户是 project(W) 的成员（否则连项目都看不到）
  AND ② membership.ssh_access == granted
        OR role in {owner, admin}   -- 管理者默认 granted
        OR platform_admin（审计）
  AND ③ ssh_mode 决定会话类型（read_only / read_write）
  AND ④ 工作区 visibility ACL（shared / private，见 24 §3.3）
  AND ⑤ W.status == running（等）
  AND ⑥ 用户已登记 SSH 公钥
```

**典型组合：**

| 用户状态 | 能否看到项目 | 能否看到机器列表 | 能否 SSH |
|----------|--------------|------------------|----------|
| 非成员 | ✗ | ✗ | ✗ |
| viewer，`ssh_access=none` | ✓ | ✓ 只读 | ✗，可申请 |
| developer，`ssh_access=none` | ✓ | ✓ | ✗，可申请 |
| developer，`granted` + `read_only` | ✓ | ✓ | ✓ 只读 shell |
| developer，`granted` + `read_write` | ✓ | ✓ | ✓ 完整 shell |
| admin | ✓ | ✓ | ✓ 默认读写 |

---

## 5. 只读 SSH 实现要点

**Launch / sync-keys 时** 按 `ssh_mode` 注入：

| 模式 | 容器内 |
|------|--------|
| `read_write` | 用户 Linux 账号（如 `alice`），home 可写 |
| `read_only` | 只读账号 `ro-alice`，或对数据目录 **bind mount `ro`**；`authorized_keys` 强制 `command="ha-shell-ro"` |

`ha-shell-ro`（agent 提供）：

- 允许：读文件、目录遍历、只读命令（`cat`、`less`、`grep`、`find`）
- 禁止：重定向写、`vim`/`nano` 写盘、`rm`/`mv`/`chmod`、`sudo`、监听端口改服务
- 实现可选：`rbash` + 白名单、`filesystem` cgroup、或对 workspace 根 **只读挂载**

Bastion `ssh-target` 响应增加 `ssh_mode`；代理层将只读用户路由到对应 Unix 账号或 ForceCommand。

审计：`ssh.allow` 的 `extra` 记录 `ssh_mode=read_only|read_write`。

---

## 6. 管理员操作

| 操作 | 谁 | API（建议） |
|------|-----|-------------|
| 添加同事（主路径） | owner/admin | `POST /projects/{id}/members` + **角色下拉** |
| 邮件邀请（未注册用户） | owner/admin | `POST /projects/{id}/invitations` |
| 转让 owner | owner | `POST .../transfer-ownership`；原 owner → `developer` |
| 授予 SSH + 指定只读/读写 | owner/admin | `PUT .../members/{uid}` body `{ ssh_access, ssh_mode }` |
| 成员自助申请 SSH | 成员 | `POST .../ssh-access-requests` body 可含期望 `ssh_mode` |
| 审批（可改 mode） | owner/admin | `POST .../approve` body `{ ssh_mode }` |
| 撤销 SSH | owner/admin | `ssh_access=revoked`；立即 sync-keys 移除 |

成员列表列展示：`角色 | SSH 状态 | SSH 模式 | 操作`。

---

## 7. 数据模型扩展

在 `memberships` 表（与 [24](24-ssh-access-and-approval.md) 合并）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `ssh_access` | enum | `none` \| `pending` \| `granted` \| `revoked` |
| `ssh_mode` | enum | `read_write` \| `read_only`；仅 `granted` 时有效，默认 `read_write` |
| `ssh_access_*` | … | 审批时间、审批人（见 24） |

---

## 8. API 与 UI 约束

- **列表过滤**：`GET /projects` 永不返回非成员项目（除 `platform_admin`）。
- **详情 404**：非成员访问项目任意路径统一 404。
- **SSH 按钮**：仅 `ssh_access=granted`（或 owner/admin）且 ACL 通过时展示；`read_only` 用不同图标/文案。
- **无 SSH 权**：展示「申请 SSH 连接权」+ 当前 `pending`/`revoked` 状态。

---

## 9. 实现状态

| 项 | 状态 |
|----|------|
| 非成员只见自己的项目列表 | ✓ `ListProjectsForUser` |
| 非成员 GET 项目 404 | ✓ `authz.RequireProjectMember` → 404 |
| `ssh_access` 审批流 | ✓ API + 成员页申请/批准 + Workspace SSH 门禁 |
| `ssh_mode` 只读 Shell | 文档定稿，agent + Bastion 待实现 |

---

## 10. 验收清单

- [ ] 未加入项目的用户侧栏无该项目，`GET /projects/{id}` 为 404  
- [ ] 成员 `ssh_access=none` 无 SSH 按钮，可申请  
- [ ] 审批为 `granted` + `read_only` 后，SSH 能登录但无法在工作区创建/修改文件  
- [ ] `read_write` 行为与现网一致  
- [ ] owner/admin 可将成员从只读升为读写  
- [ ] 移除成员后项目立即从列表消失  
