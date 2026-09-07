# 03 · 用户管理系统

> 上级：[00-index.md](00-index.md)  
> 协作扩展：[04-collaboration.md](04-collaboration.md)

---

## 1. 目标

建设平台级身份与访问控制，支撑：

- 多用户注册/邀请/禁用
- 平台角色与项目角色分离
- API、控制台、SSH 跳板共用同一身份源
- 全链路审计（谁在何时对何资源做了什么）

---

## 2. 角色模型

### 2.1 平台角色（全局）

| 角色 | 能力 |
|------|------|
| `platform_admin` | 节点、池容量、全局套餐、所有项目、模拟登录、强制释放占用 |
| `platform_ops` | 只读全局 + 节点维护（封锁/排空），不能改计费字段 |
| `platform_user` | 默认；仅能访问自己加入的项目 |
| `platform_guest` | 只读被分享的资源（可选） |

### 2.2 项目角色（Project RBAC）

| 角色 | 项目设置 | 成员管理 | 创建/删 Workspace | SSH 进入 | 下载 kubeconfig | 只读用量 |
|------|----------|----------|-------------------|----------|-----------------|----------|
| `owner` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `admin` | ✓（除转让） | ✓ | ✓ | ✓ | ✓ | ✓ |
| `developer` | ✗ | ✗ | ✓ | ✓ | ✓（限本项目） | ✓ |
| `viewer` | ✗ | ✗ | ✗ | ✗（或只读容器，默认关） | ✗ | ✓ |

转让 `owner`：仅现 owner 或 `platform_admin`。

---

## 3. 账号生命周期

```
邀请/自助注册 → email 验证（可配置关闭）→ active
     ↓
  suspended（管理员停用：JWT 拉黑、SSH 公钥失效）
     ↓
  deleted（软删；Allocation 必须先释放或转移）
```

### 3.1 注册策略（可配置）

| 模式 | 说明 |
|------|------|
| `invite_only` | **推荐默认**：管理员发邀请链接 |
| `open_register` | 开放注册 + 验证码；适合私有信任圈 |
| `oidc_only` | 仅 IdP（二期） |

### 3.2 凭据

- 密码：Argon2id；复杂度策略可配。
- MFA：管理员强制；普通用户可选 TOTP。
- API Token：个人访问令牌，scope 绑定；创建时只展示一次。
- SSH 公钥：每用户多把；指纹唯一；可标注 `laptop`/`ci`。

---

## 4. 认证流

### 4.1 控制台 / API

```
POST /auth/login { user, password, otp? }
  → access_token (短，15m) + refresh_token (长，HttpOnly Cookie 或旋转)
Authorization: Bearer <access_token>
```

刷新时检测 `token_version` / 用户 `suspended`，一键让旧令牌失效。

### 4.2 SSH（跳板）

不走密码登录 Workspace，而走：

1. 用户公钥在 `ha-api` 登记；
2. Bastion `AuthorizedKeysCommand` 回调校验指纹 → 返回 key options；
3. 登录成功后 `ForceCommand` 进入代理，再按 ACL 选 Workspace。

或：Teleport 用户证书（二期），证书内嵌 `traits: projects=[...]`。

### 4.3 服务账号

CI 用 `Project Service Account`：

- 只能操作指定 project；
- 可限制 `workspaces:create` / `deploy:k8s`；
- 建议短时 token + IP allowlist（可选）。

---

## 5. 数据模型（表级建议）

```sql
-- 示意，非最终迁移脚本
users (
  id UUID PK,
  username CITEXT UNIQUE,
  email CITEXT UNIQUE,
  password_hash TEXT,
  platform_role TEXT,
  status TEXT,           -- active|suspended|deleted
  token_version INT,
  created_at, updated_at
);

ssh_keys (
  id UUID PK,
  user_id UUID FK,
  name TEXT,
  public_key TEXT,
  fingerprint TEXT UNIQUE,
  created_at
);

projects (
  id UUID PK,
  name TEXT,
  slug TEXT UNIQUE,
  owner_id UUID FK,
  status TEXT,
  created_at
);

memberships (
  project_id UUID,
  user_id UUID,
  role TEXT,
  PRIMARY KEY (project_id, user_id)
);

api_tokens (
  id UUID PK,
  user_id UUID,
  project_id UUID NULL,  -- null = 用户级
  hash TEXT,
  scopes TEXT[],
  expires_at,
  last_used_at
);

audit_logs (
  id BIGSERIAL,
  actor_user_id UUID,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  ip INET,
  meta JSONB,
  created_at
);
```

所有涉及配额的表见 [07-resource-ledger.md](07-resource-ledger.md)。

---

## 6. API 面（用户相关）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/register` | 视注册模式 |
| POST | `/auth/login` | |
| POST | `/auth/refresh` | |
| POST | `/auth/logout` | 作废 refresh |
| GET/PATCH | `/me` | 资料 |
| GET/POST/DELETE | `/me/ssh-keys` | |
| POST | `/me/tokens` | 创建 PAT |
| GET | `/users` | admin |
| POST | `/users/{id}/suspend` | admin |
| POST | `/invitations` | 邀请入项目或平台 |

统一错误码：`401` 未认证、`403` 无权限、`409` 冲突（用户名占用等）。

前端 Refine 的 `authProvider` 只包上述接口：`login` / `logout` / `check`（`GET /me`）/ `getIdentity`；refresh 在 HTTP 层处理，不把 JWT 塞进 Refine 资源表。

---

## 7. 授权中间件逻辑

```
authenticate() → User
authorize(action, resource):
  if user.platform_role == platform_admin: allow
  if resource in platform scope: check platform_ops
  load membership(project)
  if not membership: deny
  if role_permits(membership.role, action): allow
  else deny
```

SSH 侧同等映射：`developer+` 才允许 `ssh` 到该项目 Workspace。

---

## 8. 审计要求（必须）

至少记录：

- 登录成功/失败（含 IP、UA）
- 密码/MFA/SSH key 变更
- 项目成员变更
- Workspace 创建/销毁/重建
- Allocation 预留/释放/管理员强制释放
- Bastion 会话开始/结束（会话 ID 关联）

保留期：默认 180 天（可配）；管理员不可从 UI「空日志」（防篡改可用 append-only 或定期导出对象存储）。

---

## 9. 隐私与安全实践

- 密码与 token 只存哈希。
- 日志禁止打印 Authorization、私钥、refresh。
- 管理接口二次确认 + MFA。
- 速率限制：登录、注册、邀请接受。
- GDPR/本地化合规非目标，但删除用户需级联处理密钥与成员关系。

---

## 10. 管理界面功能清单

- 用户列表 / 停用 / 重置 MFA
- 邀请链接生成与作废
- 全局会话踢下线（`token_version++`）
- 查看某用户持有的 Allocation / Workspace
- 模拟只读视角（impersonate read-only，二期）

---

## 11. MVP 裁剪

M3 必须有：

1. 本地用户 + 登录 + JWT  
2. 项目成员四人角色  
3. SSH 公钥绑定  
4. 基础 audit_logs  

可延后：OIDC、WebAuthn、细粒度 PAT scope UI、impersonate。

下一篇：[04-collaboration.md](04-collaboration.md)
