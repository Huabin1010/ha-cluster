# 31 · 代码框架分层与依赖方向

> 上级索引：[00-index.md](00-index.md)  
> 关联：ADR 见 §2；产品模型见 [22](22-project-machine-concepts.md)–[30](30-project-member-access.md)

---

## 1. 五层结构

```
Cursor rules + OpenAPI（契约）
        ↓
models + SQL migrations（领域真相）
        ↓
internal/authz + internal/approval（横切能力）
        ↓
internal/service + internal/ledger + internal/workspace（编排）
        ↓
internal/api + cmd/* + web（入口）
```

**依赖规则：** 上层可依赖下层；`models` 不依赖 `service`；`authz` 不依赖 `api`。

---

## 2. ADR（架构决策记录）

| ID | 决策 | 状态 |
|----|------|------|
| ADR-001 | 用户可见单元 = **Workspace**（Incus 系统容器），不是 k3s Namespace | 已采纳 |
| ADR-002 | 权限 = 平台角色 × 项目角色 × `ssh_access` × 工作区 `visibility` | 已采纳 |
| ADR-003 | **危险操作**（销毁 Workspace、删 Project）= 项目 admin 初审 + 平台超级管理员终审 | 已采纳 |

冲突时：实施文档 22–30 > PRD 历史段落 > 代码现状（代码须向文档对齐）。

---

## 3. 操作分级与审批链

| 级别 | 操作 | 审批链 | 包 |
|------|------|--------|-----|
| Safe | 创建 Workspace、升配、降配、SSH 授予 | 项目 owner/admin 终审 | `internal/approval` |
| Dangerous | 销毁 Workspace、删除 Project | 项目 admin 初审 → 平台终审 | `internal/approval` |

---

## 4. HTTP 错误码契约

| HTTP | 含义 |
|------|------|
| 404 | 资源不存在，或 **非项目成员** 访问项目资源 |
| 403 | 是成员但角色/ssh_access 不足 |
| 409 | 容量不足、状态冲突（如并行 resize pending） |

---

## 5. 包职责

| 包 | 职责 |
|----|------|
| `internal/models` | 实体、常量、校验函数 |
| `internal/authz` | 平台/项目/SSH 鉴权；`ErrNotFound` 用于非成员掩码 |
| `internal/approval` | 审批状态机；Safe vs Dangerous |
| `internal/store` | 持久化接口 |
| `internal/service` | 业务编排；调用 authz + approval + ledger + workspace |
| `internal/api` | HTTP 映射、JWT、路由分组 |
| `internal/workspace` | `Runtime` 接口；控制面 ↔ ha-agent 契约 |

---

## 6. 平台 API 分组

| 前缀 | 权限 |
|------|------|
| `/projects/*`、`/workspaces/*` | 项目成员（authz） |
| `/admin/*` | `platform_admin` / `platform_ops`（节点、join token、危险操作终审） |
| `/internal/*` | Bastion / agent 内部令牌 |
