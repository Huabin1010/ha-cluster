# 17 · 前后端配置与接口对接审查报告 (API & Config Review Report)

> 上级：[00-index.md](00-index.md)  
> 前端代码审查：[16-frontend-code-review.md](16-frontend-code-review.md)  
> 审查日期：2026-09-07  
> 审查范围：前后端所有 REST API 契约、网络与反代配置（Vite/OpenResty）、序列化规范、大整数精度与错误拦截链路

---

## 1. 概览与综合评级

本次审查全面覆盖了 `cmd/ha-api`、`internal/api/`（Go 服务端）与 `web/`（React + Refine 前端）之间的**网络反向代理配置**、**环境端口映射**、**数据契约与大整数处理**、**鉴权与错误流转**以及**接口覆盖率**。

### 综合评估结论
- **整体契约对接度**：**优秀 (92/100)**。核心业务链路（用户认证、项目创建与用量统计、工作区生命周期、SSH 公钥与配置下载、节点状态与容量展示、审计对账）对接严密。
- **401 Token 无感刷新机制**：设计优良，采用 Promise 单例锁有效规避了并发请求下的竞争刷新问题。
- **409 INSUFFICIENT_CAPACITY 超卖拦截**：前后端契约完全对齐，用户提示友好。
- **存在的主要优化空间**：
  1. 套餐规格（Plans）前端硬编码，未消费后端动态接口 `GET /plans`；
  2. 后端 JSON 解码启用 `DisallowUnknownFields`，前端通用 `dataProvider.create` 发送工作区时存在字段污染风险；
  3. 平台管理员专属运维配置接口（用户管理 `GET /users`、用户冻结 `POST /users/{id}/suspend`、死锁配额释放 `POST /allocations/{id}/release`）前端未提供交互界面；
  4. 侧边栏受保护入口未依据 `platform_role` 进行动态权限过滤展示。

---

## 2. 接口对接完整矩阵 (API Contract Matrix)

| 序号 | 接口路径 | HTTP 方法 | 后端 Handler / 文件 | 前端调用位置 / 机制 | 对接状态 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `/healthz` | GET | `server.go` 内联 | 运维/探针 | 已支持 | 健康检查探针 |
| 2 | `/readyz` | GET | `server.go` 内联 | 运维/探针 | 已支持 | 服务就绪探针 |
| 3 | `/auth/register` | POST | `s.register` | `Login.tsx` (`api`) | 完全对齐 | 用户名/邮箱/密码注册 |
| 4 | `/auth/login` | POST | `s.login` | `providers.ts` (`authProvider.login`) | 完全对齐 | 返回 JWT + Refresh Token |
| 5 | `/auth/refresh` | POST | `s.refresh` (`extra.go`) | `providers.ts` (`tryRefresh`) | 完全对齐 | 401 单例锁拦截自动换票 |
| 6 | `/auth/logout` | POST | `s.logout` (`extra.go`) | `providers.ts` (`authProvider.logout`) | 完全对齐 | 返回 204 No Content |
| 7 | `/nodes/heartbeat` | POST | `s.heartbeat` | ha-agent 守护进程 | 完全对齐 | 节点规格与容量上报 |
| 8 | `/internal/authorized-keys` | GET | `s.authorizedKeys` (`extra.go`) | sshd-bastion 脚本 | 完全对齐 | 内部通信 (`X-HA-Internal`) |
| 9 | `/internal/ssh-target` | GET | `s.internalSSHTarget` (`extra.go`) | ha-bastion-proxy 进程 | 完全对齐 | 内部通信 (`X-HA-Internal`) |
| 10 | `/me` | GET | `s.me` | `providers.ts` (`authProvider.check` / `getIdentity`) | 完全对齐 | 身份凭证信息拉取 |
| 11 | `/me/ssh-keys` | GET | `s.listKeys` | `SSHKeys.tsx` (`api`) | 完全对齐 | 用户公钥列表 |
| 12 | `/me/ssh-keys` | POST | `s.addKey` | `SSHKeys.tsx` (`api`) | 完全对齐 | 上传用户 SSH 公钥 |
| 13 | `/me/ssh-keys/{id}` | DELETE | `s.deleteKey` | `SSHKeys.tsx` (`api`) | 完全对齐 | 删除指定公钥 (204) |
| 14 | `/projects` | GET | `s.listProjects` | `Projects.tsx` (Refine `useList`) | 完全对齐 | 支持 admin 透传全量列表 |
| 15 | `/projects` | POST | `s.createProject` | `Projects.tsx` (Refine `useCreate`) | 完全对齐 | 创建项目与初始化成员 |
| 16 | `/projects/{id}` | GET | `s.getProject` | `Detail.tsx` (Refine `useOne`) | 完全对齐 | 项目详情 |
| 17 | `/projects/{id}/usage` | GET | `s.projectUsage` | `Detail.tsx` / `CreateForm.tsx` | 完全对齐 | 项目当前实际占用资源统计 |
| 18 | `/projects/{id}/members` | GET | `s.listMembers` | `MemberList.tsx` (`api`) | 完全对齐 | 成员列表 |
| 19 | `/projects/{id}/members` | POST | `s.addMember` | `MemberList.tsx` (`api`) | 完全对齐 | 添加成员并分配角色 |
| 20 | `/projects/{id}/members/{uid}` | DELETE | `s.removeMember` | `MemberList.tsx` (`api`) | 完全对齐 | 移除成员 (支持 RBAC 规则) |
| 21 | `/projects/{id}/invitations` | POST | `s.invite` (`extra.go`) | `MemberList.tsx` (`api`) | 完全对齐 | 生成项目邀请 Token |
| 22 | `/projects/{id}/workspaces` | POST | `s.createWorkspace` | `CreateForm.tsx` (`api`) | 完全对齐 | 创建工作区 (硬占用申请) |
| 23 | `/projects/{id}` | PATCH | `s.patchProject` (`extra.go`) | `Detail.tsx` (Refine `useUpdate`) | 完全对齐 | 更新 CPU/内存/磁盘配额 |
| 24 | `/invitations/accept` | POST | `s.acceptInvite` (`extra.go`) | `AcceptInvite.tsx` (`api`) | 完全对齐 | 接受邀请入项 |
| 25 | `/admin/reconcile` | POST | `s.reconcile` (`extra.go`) | `Audit.tsx` (`api`) | 完全对齐 | 触发对账释放死锁占用 |
| 26 | `/workspaces` | GET | `s.listWorkspaces` | `Workspaces.tsx` (Refine `useList`) | 完全对齐 | 支持按 `project_id` 过滤 |
| 27 | `/workspaces/{id}` | GET | `s.getWorkspace` | `dataProvider.getOne` | 部分对接 | 契约支持，前端无独立详情页 |
| 28 | `/workspaces/{id}/start` | POST | `s.startWorkspace` | `WorkspaceRow.tsx` (`api`) | 完全对齐 | 启动实例 (含配额硬校验) |
| 29 | `/workspaces/{id}/stop` | POST | `s.stopWorkspace` | `WorkspaceRow.tsx` (`api`) | 完全对齐 | 停止实例 (配额保留) |
| 30 | `/workspaces/{id}` | DELETE | `s.destroyWorkspace` | `WorkspaceRow.tsx` (`api`) | 完全对齐 | 销毁实例并释放配额 |
| 31 | `/workspaces/{id}/ssh-config` | GET | `s.sshConfig` | `WorkspaceRow.tsx` (`apiText`) | 完全对齐 | 客户端 SSH 配置文件片段下载 |
| 32 | `/workspaces/{id}/ssh-target` | GET | `s.sshTarget` | 无 | 未对接 | 返回直连网络节点诊断参数 |
| 33 | `/nodes` | GET | `s.listNodes` | `Nodes.tsx` (Refine `useList`) | 完全对齐 | 节点健康与架构列表 |
| 34 | `/capacity` | GET | `s.capacity` | `Capacity.tsx` (`api`) | 完全对齐 | 架构资源池可用量统计 |
| 35 | `/plans` | GET | `s.plans` | 无 (`CreateForm.tsx` 硬编码) | 未动态对接 | 前端写死规格，未拉取接口 |
| 36 | `/audit-logs` | GET | `s.audit` | `Audit.tsx` (`api`) | 完全对齐 | 最近 200 条平台审计日志 |
| 37 | `/allocations/{id}/release` | POST | `s.releaseAlloc` | 无 | 未对接 | 管理员强制解绑卡死配额 |
| 38 | `/users` | GET | `s.listUsers` | 无 | 未对接 | 平台管理员全量用户列表 |
| 39 | `/users/{id}/suspend` | POST | `s.suspend` (`extra.go`) | 无 | 未对接 | 冻结指定违规用户 |

---

## 3. 环境与反向代理配置审查

### 3.1 代理路径重写 (Path Rewrite)
- **本地开发环境 (`web/vite.config.ts`)**：
  ```ts
  proxy: {
    "/api": {
      target: process.env.VITE_API_TARGET || "http://127.0.0.1:8080",
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api/, ""),
    },
  }
  ```
- **生产部署环境 (`deploy/openresty-ha.conf`)**：
  ```nginx
  location /api/ {
    proxy_pass http://127.0.0.1:18082/;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
  }
  ```
- **审查评价**：
  - 前端以 `API_BASE = "/api"` 发起的所有以斜杠开头的请求（如 `/api/projects`）在两种环境中均能准确剥除前缀并正确路由至 Go 后端。
  - **边界风险**：在 OpenResty 中，若客户端请求不带尾部斜杠的 `/api`（无子路径），请求不会落入 `location /api/`，而是落入 `location /`，被静态托管 `try_files` 响应为 `index.html`。建议在 OpenResty 配置中增加针对 `/api` 的精确匹配或重定向。

### 3.2 端口与环境变量对齐
- 后端服务监听环境变量：`HA_API_ADDR`（默认 `:8080`，生产环境系统服务配置为 `127.0.0.1:18082`）。
- Vite 代理目标环境变量：`VITE_API_TARGET`（默认 `http://127.0.0.1:8080`，Playwright 测试集通过配置传入 `http://127.0.0.1:8088`）。
- 环境变量链条清晰，没有配置漂移。

---

## 4. 深度技术缺陷与风险排查 (Issues & Findings)

### [P1] `dataProvider.create` 潜在未知字段错误 (Unknown Field Rejection)
- **背景**：后端 `internal/api/server.go` 的 `decodeJSON` 明确启用了：
  ```go
  dec.DisallowUnknownFields()
  ```
- **隐患点**：在 `web/src/providers.ts` 中：
  ```ts
  if (resource === "workspaces") {
    const data = await api(`/projects/${variables.project_id}/workspaces`, {
      method: "POST",
      body: JSON.stringify(variables),
    });
    return { data };
  }
  ```
  如果通过 Refine 的标准 `useCreate({ resource: "workspaces", values: { project_id, name, plan, arch, visibility } })` 创建，`variables` 会把 `project_id` 序列化进请求体。而后端 `createWorkspace` 的接收体定义为：
  ```go
  var body struct {
      Name string `json:"name"`
      Plan string `json:"plan"`
      Arch string `json:"arch"`
      Visibility string `json:"visibility"`
  }
  ```
  这会直接触发 `400 Bad Request (json: unknown field "project_id")`。
- **整改建议**：在 `dataProvider.create` 中向后端发送请求前，显式解构剔除 `project_id`（`const { project_id, ...payload } = variables;`）。

---

### [P2] 套餐规格（Plans）前后端硬编码脱节
- **现状**：
  - 后端已提供动态接口：`GET /plans`，返回包含 CPU、内存、磁盘配置的数组。
  - 前端 `web/src/pages/workspaces/types.ts` 中静态硬编码了 `PLANS` 与 `PLAN_SPECS`。
- **影响**：
  - 一旦运维在后端数据库或配置中微调了套餐规格（如调整 `nano` 的内存/磁盘配额，或增加 GPU 规格），前端创建表单无法感知，导致前端展示规格与后端真实配额计算产生偏差。
- **整改建议**：
  - 在 `web/src/pages/workspaces/CreateForm.tsx` 中使用 `api<Plan[]>("/plans")` 动态获取套餐列表，并动态构建规格描述字符串，保留本地常量作为首屏加载回退。

---

### [P3] 管理类运维配置接口前端入口缺失
- **现状**：
  - `GET /users`（用户列表）：管理员添加项目成员时必须在无任何提示的情况下盲猜用户名。
  - `POST /users/{id}/suspend`（用户冻结）：后端具备平台管理能力，但前端无入口。
  - `POST /allocations/{id}/release`（强制释放配额）：对于因物理节点故障残留的死锁 allocation，除自动对账外，无手动释放途径。
  - `GET /workspaces/{id}/ssh-target`（连接目标诊断）：未在前端界面透出连接参数。
- **整改建议**：
  - 在项目成员添加表单中增加基于 `GET /users` 的自动补全下拉选单；
  - 在 `Capacity.tsx` 页面增加残留 Allocation 列表与一键释放动作。

---

### [P3] 侧边栏受保护菜单未按 RBAC 角色过滤
- **现状**：
  - `web/src/pages/Layout.tsx` 对所有用户统一展示 `/audit`（审计）入口。普通开发人员点击后虽然不会白屏（会显示 403 友好提示），但仍不够优雅。
- **整改建议**：
  - 根据 `me?.platform_role === "platform_admin" || me?.platform_role === "platform_ops"` 动态决定是否渲染审计导航条目。

---

## 5. 验收与后续整改计划

1. **第 1 阶段（高优修复）**：
   - 优化 `dataProvider.create`，剔除传入的 `project_id`，防止触发后端的严格未知字段拦截。
   - 优化 OpenResty 站点配置，针对 `/api` 增加无斜杠请求规范化重定向。
2. **第 2 阶段（动态化演进）**：
   - 将工作区创建表单中的套餐配置改为请求 `GET /plans` 动态渲染。
   - 在侧边栏导航条目中添加基于角色的显示逻辑。
3. **第 3 阶段（管理能力补齐）**：
   - 支持管理员对异常 Allocation 进行查看与单点释放。
   - 引入成员添加时的用户名联想搜索。
