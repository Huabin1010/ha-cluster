# 14 · UI 与功能测试：五组互不重叠的分工

> 上级：[00-index.md](00-index.md)  
> 运维五事：[13-remaining-tasks.md](13-remaining-tasks.md)  
> Playwright E2E：[15-playwright-test-plan.md](15-playwright-test-plan.md)  
> 更新：2026-09-06  
> 原则：**按页面 / API 域 / 测试清单切开。** 前端文件、测试用例、验收人互不抢活；与 T1–T5 运维任务正交（运维上线环境，本文件负责「产品面」与「测什么」）。

---

## 0. 和运维五事的关系（不打架）

| 轨道 | 文档 | 产出 |
|------|------|------|
| 运维上线 | [13](13-remaining-tasks.md) T1–T5 | 真机器能访问、能组网、能起容器、能 SSH |
| **产品 UI** | 本文 **U1–U5** | Refine 控制台各页可用、文案与状态正确 |
| **功能测试** | 本文 **Q1–Q5** | 用例文档 + 手工/自动化执行记录 |

- U 组 **可以在内存账本 `go run ./cmd/ha-api` 上开发**，不必等 T1 上 VPS。  
- Q 组 **冒烟** 可在本地做；**联调/验收** 建议在 T1 或 T4 就绪后做一轮回归。  
- Q 组 **禁止** 去改 OpenResty / 安全组 / payload（那是 T*）；发现环境问题记 issue，转给对应 T 负责人。  
- U 组 **禁止** 改 `packaging/`、`deploy/*.service`（除非只改前端下载的 SSH Host 常量且与 T5 对齐）。

```
本地开发：U1–U5 ∥ Q1–Q3（API 已有即可）
环境就绪：Q4 对节点/Fabric，Q5 对 SSH（依赖 T4/T5）
上线门禁：U 全部 DoD + Q 冒烟全绿 + 13 的 T1–T5 勾选
```

---

## 1. 总分工表（10 个坑位，互不重叠）

### 1.1 UI 五组（U）

| ID | 名称 | 独占页面 / 文件 | 主 API | 不碰 |
|----|------|-----------------|--------|------|
| **U1** | 壳子与登录 | `Login.tsx`、`Layout.tsx`、`styles.css`、`App.tsx` 路由壳、`providers.ts` 的 **auth** 段 | `/auth/*`、`/me` | 不改 Projects/Workspaces/Nodes/Members 页逻辑 |
| **U2** | 项目 | `Projects.tsx` 及项目详情/预算子组件（新建放 `pages/projects/`） | `/projects`、`PATCH /projects/{id}`、`/usage` | 不改成员邀请、不改创建 Workspace 表单 |
| **U3** | 成员与邀请 | `Members.tsx`（可拆 `pages/members/`） | `/members`、`/invitations`、`accept` | 不改登录、不改节点页 |
| **U4** | Workspace 生命周期 | `Workspaces.tsx`（可拆 `pages/workspaces/`） | `/workspaces*`、创建、启停删、SSH config | 不改 Layout 导航结构（只注册路由由 U1 合入时开洞） |
| **U5** | 节点 / 容量 / 审计 | `Nodes.tsx` + 新页 `Capacity`/`Audit`/`Keys`（`pages/ops/`） | `/nodes`、`/capacity`、`/audit-logs`、`/me/ssh-keys`、admin reconcile | 不改创建机表单 |

**合入约定：** U2–U5 若需新导航入口，只提 PR 描述「请 U1 在 Layout 加一条 NavLink」；U1 统一改 `Layout.tsx` / `App.tsx`，避免五人同时改路由文件冲突。

### 1.2 功能测试五组（Q）

| ID | 名称 | 测什么 | 用例文件（独占） | 不测 |
|----|------|--------|------------------|------|
| **Q1** | 认证与会话 | 注册/登录/刷新/退出/停用 | `docs/qa/Q1-auth.md` + `web`/`api` 相关单测扩展 | 不测配额、不测 SSH |
| **Q2** | 项目与 RBAC | 角色矩阵、预算 | `docs/qa/Q2-rbac.md` | 不测 Fabric ping |
| **Q3** | 账本与 Workspace | 占用/超卖/回滚/关机仍占 | `docs/qa/Q3-ledger.md` | 不测 OpenResty |
| **Q4** | 节点与容量展示 | 心跳、Ready、arch 池、对账 | `docs/qa/Q4-nodes.md` | 不测 Bastion ForceCommand |
| **Q5** | SSH 与跳板体验 | config 下载、ACL、进容器 | `docs/qa/Q5-ssh.md` | 不测打包脚本 |

自动化：各 Q 可在自己的 `*_test.go` / `*.test.ts` 下加用例，**文件归属按包**：

| 测试代码目录 | 归属 |
|--------------|------|
| `internal/auth/*_test.go`、登录相关 API 测 | Q1（可改） |
| `internal/service` 里 membership/budget 测 | Q2 |
| `internal/ledger/*`、`service` workspace 占用测 | Q3 |
| `internal/agent/*`、nodes/capacity API 测 | Q4 |
| `internal/bastion/*`、ssh-target API 测 | Q5 |
| `web/src/providers.test.ts` | **U1/Q1 共管**：U1 改 auth provider 时同步测；Q1 写用例清单 |

---

# 第一部分：UI 任务详表（U1–U5）

## U1 · 壳子、登录、会话、全局体验

> **状态：已完成（2026-09-06）** — 登录/注册折叠、Layout 用户名+环境角标+窄屏抽屉、`api`/`apiText` 401→refresh→`/login?reason=expired`、`check` 仅 401 清会话（网络/5xx 保壳）、鉴权 Loading、已登录访问 `/login` 回跳、`web/src/ui/*`（Toast `show`/`push`、Banner、Empty、Loading、PageBody、Button）。

### 现状缺口（交付前；已关闭）

- 登录页有默认账号文案，无「注册」、无 refresh 失效提示。  
- Layout 无当前用户名、无环境角标（dev/prod）。  
- `providers.ts` 已存 `ha_refresh`，但无自动 refresh、无 401 统一跳转体验打磨。  
- 暗色仅自写 CSS，无统一空态/加载/错误条组件。

### 必须交付的界面

1. **登录页**  
   - 用户名、密码、登录按钮、错误信息（401 显示「用户名或密码错误」）。  
   - 可选折叠「注册」：调 `POST /auth/register`（若产品暂关闭开放注册，则隐藏并写注释）。  
   - 去掉生产构建里写死的默认密码（可用 `import.meta.env.DEV` 仅开发预填）。  
2. **布局壳**  
   - 侧栏：项目 / 成员 / Workspace / 节点（入口占位，具体页由 U2–U5 填）。  
   - 顶栏或侧栏底：当前用户名、`退出`。  
   - 全局 `Loading`：路由切换或 `useList` isLoading 时主区 skeleton 或转圈。  
   - 全局 `ErrorBanner`：可被各页触发（简单 React context，文件 `web/src/ui/Toast.tsx` **属 U1**）。  
3. **会话**  
   - 登录响应写入 `token` + `refresh_token`。  
   - `api()` 遇 401：尝试 `POST /auth/refresh` 一次，失败再清 storage 跳登录。  
   - 退出：调 `POST /auth/logout`（带 refresh）再清本地。  
4. **无障碍小项**  
   - 表单 `label` 齐全；主按钮 `type="submit"`；焦点可见。

### 独占文件

```
web/src/pages/Login.tsx
web/src/pages/Layout.tsx
web/src/App.tsx          # 仅路由注册与 Authenticated 壳
web/src/providers.ts     # auth + api 封装；dataProvider 骨架可留，资源细节 U2–U5 扩
web/src/styles.css
web/src/ui/*             # 新建：Button/Banner/Empty 等，U1 维护
```

### 验收（UI）

| # | 操作 | 期望 |
|---|------|------|
| 1 | 错误密码登录 | 红字错误，不进首页 |
| 2 | 正确登录 | 进 `/projects`，侧栏见用户名 |
| 3 | 清掉 token 强刷 | 回登录页 |
| 4 | 退出 | 无法再进需鉴权页 |
| 5 | 窄屏 375px | 侧栏可滚动或可折叠，不横向撑破 |

### 不做

项目 CRUD 表单、创建 Workspace、节点表格列、成员邀请 UI。

---

## U2 · 项目

### 现状缺口

- 仅名称 + slug 创建与列表。  
- 无项目详情、无预算编辑、无用量展示（用量现挂在 Workspace 页，应收到项目侧）。

### 必须交付的界面

1. **项目列表**  
   - 列：名称、slug、id（可复制）、创建时间（若 API 有）。  
   - 空态：「还没有项目，创建一个」。  
   - 行点击进入详情（路由 `/projects/:id`）。  
2. **创建项目**  
   - 校验：slug 小写字母数字短横线；失败展示 API 错误。  
3. **项目详情**  
   - 展示 usage：`GET /projects/{id}/usage`（cpu/mem/disk/workspaces 数）。  
   - 编辑预算：`PATCH` `budget_cpu_milli` / `budget_mem_bytes` / `budget_disk_bytes`（0=不限制）。  
   - 入口「去创建 Workspace」链到 `/workspaces?project_id=`（U4 读 query）。

### 独占文件

```
web/src/pages/Projects.tsx
web/src/pages/projects/*     # 新建 Detail.tsx 等
```

`providers.ts` 里若需 `getOne('projects')`，U2 可改 **仅 projects 分支**，在 PR 说明；auth 段不动。

### 验收（UI）

| # | 操作 | 期望 |
|---|------|------|
| 1 | 创建项目 | 列表出现 |
| 2 | 打开详情 | 见用量数字 |
| 3 | 设 mem 预算极小再去 U4 建 large | 应 409（联调；UI 需展示错误文案） |
| 4 | 非法 slug | 前端或 API 错误可见 |

### 不做

成员表、邀请 token、节点页、SSH 下载按钮。

---

## U3 · 成员与邀请

### 现状缺口

- 成员页要手填 project uuid。  
- 无「从项目详情带入 id」、无角色中文说明、无接受邀请页。

### 必须交付的界面

1. **成员列表**  
   - 支持从路由 `/projects/:id/members` 或 query `?project_id=` 进入（与 U2 链接约定）。  
   - 列：user_id（或用户名若后续 API 扩展）、role。  
   - 添加成员：username + role 下拉（owner 不可通过此表单转让，文案写明）。  
   - 移除成员：确认对话框后 `DELETE`。  
2. **邀请**  
   - 生成邀请：email + role → 展示 token（可复制）；说明「把 token 发给对方」。  
   - **接受邀请页** `/invitations/accept`：输入 token → `POST /invitations/accept` → 提示成功并跳项目。  
3. **角色说明** 旁注：viewer 只读；developer 可 SSH/建机；admin 可管成员；owner 可改预算。

### 独占文件

```
web/src/pages/Members.tsx
web/src/pages/members/*
web/src/pages/AcceptInvite.tsx
```

路由注册：向 U1 提「加 `/invitations/accept` 与 `/projects/:id/members`」。

### 验收（UI）

| # | 操作 | 期望 |
|---|------|------|
| 1 | owner 加 developer | 列表出现 |
| 2 | 生成邀请 token | 可复制（及邀请链接） |
| 3 | 另一用户登录接受邀请 | 跳 `/projects/:id`，能看到该项目 |
| 4 | viewer 打开成员页尝试移除 | 403 错误可见（「没有权限做这件事」） |

### DoD（已闭环 2026-09-06）

- 路由：`/members`、`/members?project_id=`、`/projects/:id/members`、`/invitations/accept[?token=]`
- 角色旁注 + owner 不可经表单转让
- API：`POST /invitations/accept` 返回 `project_id`；单测 `TestMembersInviteAcceptAndRBAC` / `roles.test.ts`

### 不做

Workspace 创建、节点 Fabric、登录 refresh 逻辑。

---

## U4 · Workspace

### 现状缺口

- 手填 project uuid；启停/销毁无按钮；状态无中文；SSH 仅下载无说明；无 private/shared。

### 必须交付的界面

1. **列表**  
   - 列：名称、套餐、arch、状态（中文映射：`running=运行中`，`stopped=已停止（仍占配额）`，`fabric_degraded=网络降级`，`failed=失败`）。  
   - 筛选：按 `project_id`（query）。  
2. **创建**  
   - 项目下拉（`useList projects`）代替纯手填 uuid（可保留高级粘贴）。  
   - 套餐、arch、visibility（shared/private）、名称。  
   - 提交前可调 usage 提示「当前已用」。  
   - **409 INSUFFICIENT_CAPACITY** 用醒目错误，展示「资源不足，请换套餐或节点」。  
3. **行内操作**  
   - 启动 / 停止 / 销毁（销毁二次确认）。  
   - 下载 SSH config。  
   - 「复制 workspace id」。  
4. **空态与禁止**  
   - stopped 仍占配额：停止成功后 toast 提示，勿暗示已释放。

### 独占文件

```
web/src/pages/Workspaces.tsx
web/src/pages/workspaces/*
```

### 验收（UI）

| # | 操作 | 期望 |
|---|------|------|
| 1 | 选项目建 nano | 列表 running |
| 2 | 停止 | 状态 stopped，文案含「仍占配额」 |
| 3 | 再开 | running |
| 4 | 销毁 | 列表消失或 status destroyed；配额可再建 |
| 5 | 超卖 | 错误条出现 INSUFFICIENT / 资源不足 |
| 6 | 下载 SSH config | 文件可保存，内容含 Host/RemoteCommand |

### 不做

节点表格、成员邀请、改全局 CSS 主题（用 U1 的 Banner）。

---

## U5 · 节点、容量、SSH 公钥、审计

### 现状缺口

- 节点表无 fabric_path/rtt、无容量池汇总。  
- 无「我的 SSH 公钥」管理页。  
- 无审计日志页；无管理员一键 reconcile。

### 必须交付的界面

1. **节点页增强**  
   - 列：name、arch、power、ready、fabric_ip、fabric_path、rtt、内存 used/alloc。  
   - Ready=false 或 path=stale/relay 用颜色标记。  
2. **容量页** `/capacity`  
   - 调 `GET /capacity`，按 arch 展示 free cpu/mem/disk。  
3. **SSH 公钥** `/settings/keys`  
   - 列表 / 添加（name + public_key）/ 删除。  
4. **审计** `/audit`（仅 admin/ops，403 时友好提示）  
   - `GET /audit-logs` 表格。  
5. **管理员** 按钮「对账」→ `POST /admin/reconcile`，展示 released / stale_nodes。

### 独占文件

```
web/src/pages/Nodes.tsx
web/src/pages/ops/Capacity.tsx
web/src/pages/ops/SSHKeys.tsx
web/src/pages/ops/Audit.tsx
```

### 验收（UI）

| # | 操作 | 期望 |
|---|------|------|
| 1 | 有心跳节点 | 表中 Ready 正确 |
| 2 | 添加公钥 | 列表出现 fingerprint |
| 3 | admin 打开审计 | 有登录/创建等记录 |
| 4 | 非 admin 打开审计 | 明确无权限 |

### 不做

创建 Workspace、项目预算表单、登录页。

---

# 第二部分：功能测试任务详表（Q1–Q5）

每组交付物统一为：

1. `docs/qa/Qx-*.md`：用例表（编号、前置、步骤、期望、自动化与否）  
2. 执行记录：日期、环境（local / T1 URL）、结果 Pass/Fail、缺陷链接  
3. 能自动化的补测试代码（归属见 §1.2）

**严重级别约定：** P0 阻塞上线；P1 主路径坏；P2 体验；P3 文案。

---

## Q1 · 认证与会话

### 范围

只测身份：注册、登录、JWT、refresh、logout、suspend、错误密码。

### 用例清单（必须写进 `docs/qa/Q1-auth.md`）

| ID | 标题 | 步骤摘要 | 期望 | 建议自动 |
|----|------|----------|------|----------|
| Q1-01 | 注册成功 | POST register 新用户 | 201，可登录 | ✓ API |
| Q1-02 | 用户名冲突 | 重复 username | 409/conflict | ✓ |
| Q1-03 | 密码过短 | password&lt;6 | 4xx | ✓ |
| Q1-04 | 登录成功 | 正确账密 | 200，有 token+refresh_token | ✓ |
| Q1-05 | 登录失败 | 错密码 | 401，无 token | ✓ |
| Q1-06 | 无 Bearer 访问 /me | — | 401 | ✓ |
| Q1-07 | 假 Bearer | 乱写 token | 401 | ✓ |
| Q1-08 | refresh 轮换 | login → refresh → 旧 refresh 再刷 | 第二次 401 | ✓ |
| Q1-09 | logout | logout 后 refresh 失效 | 401 | ✓ |
| Q1-10 | 停用用户 | admin suspend 后登录 | 401 | ✓ |
| Q1-11 | UI 登录错误 | 浏览器错密 | 见错误不跳转 | 手工 / U1 测 |

### 前置

本地 `go run ./cmd/ha-api` 或 T1 URL。不依赖 Incus/EasyTier。

### 不做

建 Workspace、SSH、安全组。

---

## Q2 · 项目与 RBAC

### 范围

项目 CRUD、四人角色、邀请、预算；**不测** 物理节点。

### 用例清单（`docs/qa/Q2-rbac.md`）

| ID | 标题 | 步骤摘要 | 期望 |
|----|------|----------|------|
| Q2-01 | 创建项目 | owner 登录创建 | 自己为 owner 成员 |
| Q2-02 | slug 冲突 | 同 slug 再建 | conflict |
| Q2-03 | viewer 不能建机 | 加 viewer，POST workspace | 403 |
| Q2-04 | developer 能建机 | — | 201（内存 runtime 即可） |
| Q2-05 | viewer 不能加成员 | POST members | 403 |
| Q2-06 | admin 能加成员 | — | 201 |
| Q2-07 | 邀请接受 | invite → 另一用户 accept | 出现 membership |
| Q2-08 | 过期/重复 accept | 改 expires 或二次 accept | conflict（能测则测） |
| Q2-09 | 项目预算拦截 | budget_mem 设极小，建 nano | 409 |
| Q2-10 | private Workspace | owner 建 private；developer SSH target | 403；owner 200 |
| Q2-11 | UI 角色说明 | 打开成员页 | 有角色说明（对 U3） |

### 账号准备脚本（Q2 维护）

在 `docs/qa/fixtures.md` 写清：如何注册 owner/dev/viewer 三账号（或 curl 脚本 `scripts/qa-seed-rbac.sh`，**属 Q2**）。

### 不做

超卖并发（Q3）、节点 stale（Q4）、Bastion（Q5）。

---

## Q3 · 账本与 Workspace 生命周期

### 范围

硬占用、超卖、失败回滚、停止不释放、销毁归还、并发。

### 用例清单（`docs/qa/Q3-ledger.md`）

| ID | 标题 | 步骤摘要 | 期望 | 自动 |
|----|------|----------|------|------|
| Q3-01 | 创建占用 | 建 large，看 nodes used_mem | used 增加 | ✓ 已有单测可扩 |
| Q3-02 | 同节点超卖 | 可售仅够 1×large，建第二个 | 409 INSUFFICIENT_CAPACITY | ✓ |
| Q3-03 | arch 隔离 | 只有 arm64 节点，要 amd64 | 409 | ✓ |
| Q3-04 | 控制面不调度 | 仅 control-plane 节点 | 409 | ✓ |
| Q3-05 | 停止不释放 | stop 后再建同规格 | 仍 409 | ✓ |
| Q3-06 | 销毁归还 | destroy 后再建 | 201 | ✓ |
| Q3-07 | 运行时失败回滚 | FailLaunchOnce | used 回到 0 | ✓ |
| Q3-08 | 并发防超卖 | 32 并发 large | 恰好 1 成功 | ✓ |
| Q3-09 | reconcile 孤儿 | 标 destroyed 后 admin reconcile | released≥1 | ✓ |
| Q3-10 | UI 超卖文案 | 控制台触发 409 | 用户能看懂（对 U4） | 手工 |
| Q3-11 | 套餐目录 | GET /plans | 含 nano…xlarge | ✓ |

### 前置

内存 store 即可；不依赖真实 Incus（除注明「路径 A」的联调项交给 Q4/Q5）。

### 不做

ping EasyTier、sshd ForceCommand。

---

## Q4 · 节点、心跳、容量、对账展示

### 范围

agent 心跳、节点列表、capacity 池、stale、UI 节点页（对 U5）。

### 用例清单（`docs/qa/Q4-nodes.md`）

| ID | 标题 | 步骤摘要 | 期望 |
|----|------|----------|------|
| Q4-01 | 心跳注册 | POST /nodes/heartbeat | 200，GET /nodes 可见 |
| Q4-02 | 心跳更新 | 改 fabric_ip 再心跳 | 列表更新 |
| Q4-03 | capacity 分 arch | amd64+arm64 节点 | pools 分开 |
| Q4-04 | stale | last_heartbeat 改旧，reconcile | ready=false |
| Q4-05 | agent 本机容量 | `ha-agent --once`（有 /proc） | cpu/mem&gt;0 |
| Q4-06 | UI 节点色 | Ready false | 有区分（对 U5） |
| Q4-07 | 联调 T4 | 真 worker 心跳 | 与 inventory 名一致 |

Q4-07 依赖运维 T4，可标「阻塞：等 T4」；Q4-01–06 本地可完成。

### 不做

用户 SSH 进容器、打 payload 哈希（T3/Q 外）。

---

## Q5 · SSH、跳板、公钥

### 范围

ssh-config、ssh-target ACL、bastion Resolve/Dial、公钥 CRUD；联调真 SSH（等 T5）。

### 用例清单（`docs/qa/Q5-ssh.md`）

| ID | 标题 | 步骤摘要 | 期望 | 环境 |
|----|------|----------|------|------|
| Q5-01 | 下载 config | GET ssh-config | 含 Host、RemoteCommand、用户名 | local |
| Q5-02 | developer ssh-target | running 共享机 | 200 host/port | local |
| Q5-03 | viewer ssh-target | — | 403 | local |
| Q5-04 | stopped ssh-target | — | 4xx | local |
| Q5-05 | private ACL | 见 Q2-10 | 403/200 | local |
| Q5-06 | Resolve 优先 fabric | 单测 | via=fabric | ✓ |
| Q5-07 | DialProxy | 单测 | 回显 | ✓ |
| Q5-08 | 公钥 CRUD | POST/GET/DELETE /me/ssh-keys | 正常 | local |
| Q5-09 | authorized-keys 内部口 | 错 INTERNAL_TOKEN | 401 | local |
| Q5-10 | 真 SSH 进 Workspace | T5 环境 | hostname≠VPS | **T5 后** |
| Q5-11 | ForceCommand 不落 VPS shell | — | 无法随意 root 宿主机 | **T5 后** |
| Q5-12 | UI 下载按钮 | U4 页 | 文件可用 | 手工 |

### 不做

安全组、OpenResty、打包。

---

# 第三部分：协作接口与日程

## 跨组接口（写死，避免扯皮）

| 生产者 | 消费者 | 约定 |
|--------|--------|------|
| U1 | U2–U5 | `api()`、Banner、登录态 |
| U2 | U3/U4 | 项目 id 经路由/query 传递：`?project_id=` 或 `/projects/:id/...` |
| U4 | Q3/Q5 | 409 文案关键字含「不足」或 `INSUFFICIENT` |
| U5 | Q4 | 节点 Ready 列可被测到（data-testid 建议：`node-ready`） |
| Q2 | U3 | fixtures 三账号用户名写在 `docs/qa/fixtures.md` |
| T1 | 全体 Q | 验收环境 URL |
| T4/T5 | Q4-07 / Q5-10 | 联调窗口 |

**建议 data-testid（谁做页谁加）：**

- U1：`login-submit`、`nav-projects`  
- U2：`project-create`、`project-row`  
- U3：`member-add`、`invite-token`  
- U4：`ws-create`、`ws-error`、`ws-ssh-download`  
- U5：`node-ready`、`keys-add`

## 建议排期（与 13 并行）

| 周 | UI | QA | 运维 |
|----|----|----|------|
| 1 | U1 壳 + U2 项目 | Q1 认证用例 + 自动 | T1∥T2∥T3 |
| 2 | U3 成员 + U4 Workspace | Q2+Q3 | T4 |
| 3 | U5 节点/密钥/审计 | Q4；T5 后 Q5-10/11 | T5 |
| 4 | UI 打磨、合入 | 全量回归签到 | 勾选 13 |

## 完成勾选

### UI

| 任务 | 负责人 | 开始 | 完成 | 验收人 |
|------|--------|------|------|--------|
| U1 壳与登录 | Cursor | 2026-09-06 | 2026-09-06 | refresh/会话；`npm test` |
| U2 项目 | Cursor | 2026-09-06 | 2026-09-06 | 列表+详情/预算 |
| U3 成员邀请 | Cursor | 2026-09-06 | 2026-09-06 | 成员/邀请/接受；roles 单测 |
| U4 Workspace | Cursor | 2026-09-06 | 2026-09-06 | 启停删+SSH+409 |
| U5 节点/容量/审计/密钥 | Cursor | 2026-09-06 | 2026-09-06 | Nodes/Capacity/Keys/Audit |

### QA

| 任务 | 负责人 | 用例文档 | 本地冒烟 | 联调回归 |
|------|--------|----------|----------|----------|
| Q1 认证 | | `docs/qa/Q1-auth.md` | | |
| Q2 RBAC | | `docs/qa/Q2-rbac.md` | | |
| Q3 账本 | | `docs/qa/Q3-ledger.md` | | |
| Q4 节点 | | `docs/qa/Q4-nodes.md` | | |
| Q5 SSH | | `docs/qa/Q5-ssh.md` | | |

---

## 附录：本地一键给 UI/QA 用的环境

```bash
export PATH="$HOME/.local/go/bin:$PATH"
go run ./cmd/ha-api          # :8080 内存账本 + admin/123456qq
cd web && npm run dev        # :5173 proxy /api
```

QA 用 curl 示例见各 `docs/qa/Qx-*.md`（由对应 Q 负责人创建文件时补全；本文件已规定必须存在的用例 ID，创建文件时把上表抄进去并勾选自动化列）。

**上线门禁建议：** U1–U5 DoD 全勾 + Q1–Q3 自动全绿 + Q4/Q5 在 T4/T5 环境签字 + [13](13-remaining-tasks.md) T1–T5 签字。
