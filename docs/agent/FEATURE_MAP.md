# ha-cluster 控制台 Feature Map

从**用户视角**写清：功能怎么进、子功能有哪些、快捷键、CDP / Playwright 选择器。Agent 代用户点 UI 或验收时先读本文，不要在源码里猜入口。

口头词：用户说「机器 / 服务器」= Workspace；「开通」= 创建工作区。原始枚举（`FAILED`、`destroy_pending_platform`）只作悬停技术追溯，不要当界面文案。

凭据：**不要**把密码写进本文件。登录账号见 `docs/credentials.local.md`（本地实验室）和 `web/e2e/fixtures/auth.ts`（E2E 角色）。

控制台默认 `http://127.0.0.1:5173`（`bun run dev` / `bun scripts/dev.ts`）。Dialog 用 Radix，不要原生 `<select>` / `window.confirm`。E2E 辅助：`web/e2e/helpers/dialog.ts` 的 `openCreateDialog` / `chooseSelect` / `confirmAlert`。

选择器一律 `data-testid`。同一 testid 若桌面子侧栏与窄屏顶栏都有，用容器收窄：

- 项目：`[data-testid=project-subnav] [data-testid=project-tab-workspaces]`（桌面）或 `[data-testid=project-mobile-tabs] [data-testid=project-tab-workspaces]`（窄屏）
- 机器：桌面子侧栏 `ws-nav-*`，窄屏顶栏 `ws-tab-*`（不重复）

---

## 壳与导航

### 怎么进入

登录成功后任意已鉴权页。左侧主侧栏常驻；进入项目详情或机器详情时，桌面再出二级侧栏。

### 子功能

- 收起 / 展开主侧栏
- 项目切换 Combobox（有项目时）
- 主题切换、退出
- 窄屏：顶栏「菜单」打开侧栏
- 品牌标志：六边形集群 SVG（侧栏 / 窄屏顶栏 / 登录页）

### 快捷键

无。

### 选择器

| 用户看到的 | testid | 角色门 |
|---|---|---|
| 侧栏「项目」 | `nav-projects` | 已登录 |
| 侧栏「成员」 | `nav-members` | 已登录 |
| 侧栏「用户」 | `nav-users` | `platform_admin` |
| 侧栏「服务器」 | `nav-workspaces` | 已登录 |
| 侧栏「节点」 | `nav-nodes` | `platform_admin` / `platform_ops` |
| 侧栏「容量」 | `nav-capacity` | 同上 |
| 侧栏「SSH 公钥」 | `nav-keys` | 已登录 |
| 侧栏「审计」 | `nav-audit` | `platform_admin` / `platform_ops` |
| 侧栏「危险待审」 | `nav-dangerous` | 前端 `canApproveDangerousOps`；终审后端仅 `platform_admin` |
| 侧栏「镜像仓库」 | `nav-docker-registries` | `platform_admin` |
| 侧栏「域名配置」 | `nav-ingress-domains` | `platform_admin` |
| 当前项目切换 | `nav-project-switch` | 已登录且有项目 |
| 收起侧栏 | `sidebar-collapse` | 桌面 |
| 窄屏打开菜单 | `nav-toggle` | 窄屏 |
| 品牌 Logo | `brand-logo` | 已登录（侧栏 / 窄屏顶栏） |
| 环境徽章 | `env-badge` | 已登录 |
| 当前用户名 | `current-user` | 已登录 |
| 退出 | `logout-button` | 已登录 |
| 主题 | `theme-toggle` | 登录页与壳 |

无权限的侧栏项会被 accessControl 藏掉，不要按「代码里有路由」硬点。

相关 E2E：`web/e2e/pw1-auth-shell/`。

---

## 登录 / 注册 / 会话

### 怎么进入

未登录访问任意需鉴权 URL → `/login`。URL：`/login`。

### 子功能

- 用户名密码登录
- 开发态一键管理员登录
- 展开注册（用户名/密码用上方字段，另填邮箱）
- 错误 / 提示条

### 快捷键

无。

### 选择器

| 用户看到的 | testid | 角色门 |
|---|---|---|
| 用户名 | `login-username` | 公开 |
| 密码 | `login-password` | 公开 |
| 登录 | `login-submit` | 公开 |
| 一键管理员（仅 DEV） | `login-dev-submit` | 仅 localhost / Vite DEV |
| 展开注册 | `login-register-open` | 公开（`OPEN_REGISTER`） |
| 注册邮箱 | `login-register-email` | 注册展开后 |
| 创建账号 | `login-register-submit` | 注册展开后 |
| 错误 | `login-error` | 失败时 |
| 提示 | `login-info` | 成功提示时 |

空态：表单本身。失败：`login-error`。

相关 E2E：`web/e2e/pw1-auth-shell/login.spec.ts`、`session.spec.ts`。

---

## 项目

### 怎么进入

侧栏 `nav-projects` → `/projects`。点行内「详情」或项目名 → `/projects/:id`。桌面二级侧栏 `project-subnav`；窄屏顶栏 `project-mobile-tabs`。

### 子功能

- 列表：创建、编辑、删除、复制 ID
- 详情 Tab：项目概览 / 工作区服务器 / 成员与权限 / 设置与预算
- 概览：用量卡片、跳到服务器列表
- 设置：预算 CPU/内存/磁盘、保存、删除项目

### 快捷键

无。

### 选择器

**列表 `/projects`**

| 用户看到的 | testid |
|---|---|
| 新建项目 | `project-create-open` |
| 创建表单 | `project-create-form` |
| 名称 / slug | `project-name` / `project-slug` |
| 提交创建 | `project-create` |
| 列表错误 | `project-list-error` |
| 项目行 | `project-row` |
| 复制 ID | `project-copy-id` |
| 进入详情 | `project-detail` |

进详情请点 `project-detail`，不要点行中央（会命中复制 ID，被 `stopPropagation` 拦住）。
| 编辑 / 删除 | `project-edit` / `project-delete` |
| 编辑表单 / 保存 | `project-edit-form` / `project-save` |
| 表单错误 | `project-error` |
| 确认删除 | `confirm-ok` / `confirm-cancel` |

**详情**

| 用户看到的 | testid | 备注 |
|---|---|---|
| 二级侧栏容器 | `project-subnav` | 桌面 |
| 返回全部项目 | `project-back-list` | 桌面 |
| 项目概览 | `project-tab-overview` | 桌面侧栏 + 窄屏顶栏（用容器收窄） |
| 工作区服务器 | `project-tab-workspaces` | 同上 |
| 成员与权限 | `project-tab-members` | 同上 |
| 设置与预算 | `project-tab-settings` | 同上 |
| 窄屏 Tab 条 | `project-mobile-tabs` | `md:hidden` |
| 项目 ID | `project-id` | |
| 用量卡片 | `project-usage` | |
| 预算输入 | `budget-cpu` / `budget-mem` / `budget-disk` | owner |
| 保存预算 | `budget-save` | owner |
| 空列表 | `empty-state` | 通用空态 |

角色门：非成员项目 404；改预算 / 删项目需 owner；viewer 不能申请机器。

相关 E2E：`web/e2e/pw2-projects/`。

---

## 服务器（Workspace）

### 怎么进入

- 全局列表：侧栏 `nav-workspaces` → `/workspaces`（可用 `?project_id=`）
- 项目内：项目详情 `project-tab-workspaces` → `/projects/:id/workspaces`
- 机器详情：行内「管理」`ws-manage` → `/workspaces/:id`（Tab：概览 / 连接 / 域名接入 / 操作历史）

### 子功能

- 项目内列表右上角「新建工作区」同样是 `ws-create`（自定义 trigger，不要漏 testid）
- 按项目筛选、含异常、刷新
- **开通 / 销毁 / 审批过程会自动轮询**（约 3s）：`provisioning`「开通中」、`destroying`、待审批不必点「刷新列表」等稳态
- 销毁确认后弹窗确认按钮进入 loading；行状态同步为「销毁中」旋转徽章，直到列表刷新到稳态或行消失
- 行内：审批创建、驳回、启停、升配、销毁申请/初审、网页终端、一键 SSH、下载 ssh-config、导入公钥
- 机器详情：网页终端、复制 SSH、Ingress、审计历史

### 快捷键

无。

### 选择器

**列表**

| 用户看到的 | testid |
|---|---|
| 开通 / 申请服务器 | `ws-create` |
| 项目 / 名称 / 套餐 / 架构 / 可见性 | `ws-project-select` / `ws-name-input` / `ws-plan-select` / `ws-arch-select` / `ws-visibility-select` |
| 提交开通 | `ws-submit` |
| 项目筛选 | `ws-filter-project` |
| 含异常 | `ws-show-abnormal` |
| 刷新 | `ws-refresh` |
| 待审批横幅 | `ws-pending-banner` / `ws-resize-banner` / `ws-destroy-banner` |
| 列表错误 / 容量不足 | `ws-error`（容量不足时外层还有 `ws-insufficient`） |
| 服务器行 | `ws-row`（`data-status` 为原始状态） |
| 升配待审徽章 | `ws-resize-pending` |
| 批准 / 驳回创建 | `ws-approve` / `ws-reject`（确认 `reject-ok` / `reject-cancel`） |
| 批准 / 驳回升配 | `ws-resize-approve` / `ws-resize-reject` |
| 升配 Dialog | `ws-resize` → `ws-resize-cpu` / `ws-resize-mem` / `ws-resize-disk` / `ws-resize-submit` / `ws-resize-preview` / `ws-resize-confirm` |
| 启动 / 停止 | `ws-start` / `ws-stop` |
| 取消申请 | `ws-cancel-request` |
| 销毁 / 项目初审销毁 | `ws-destroy` / `ws-destroy-approve-project` |
| 平台强毁（破窗） | `ws-destroy-force` |
| 去申请 SSH | `ws-request-ssh` |
| 网页终端 | `ws-web-terminal` |
| 管理详情 | `ws-manage` |
| 复制 SSH / 下载 config | `ws-copy-ssh` / `ws-ssh-download` |
| 导入公钥 | `ws-import-key` → `ws-keys-name` / `ws-keys-pubkey` / `ws-keys-submit` |
| 无公钥回退复制 | `ws-copy-ssh-fallback` / `ws-copy-ssh-fallback-confirm` |
| 危险确认 | `confirm-ok` / `confirm-cancel` |

**机器详情**

| 用户看到的 | testid |
|---|---|
| 二级侧栏 | `ws-subnav` |
| 返回全部服务器 | `ws-back-list` |
| 概览 / 连接 / 域名 / 历史（桌面） | `ws-nav-overview` / `ws-nav-connect` / `ws-nav-ingress` / `ws-nav-history` |
| 同上（窄屏） | `ws-tab-overview` / `ws-tab-connect` / `ws-tab-ingress` / `ws-tab-history` |
| 窄屏 Tab 条 | `ws-mobile-tabs` |
| 概览指标 | `ws-overview-stats` |
| 概览打开终端 | `ws-overview-terminal` |
| 概览审计行 | `ws-overview-audit-row` |
| SSH 命令 / 复制 | `ws-ssh-cmd` / `ws-copy-ssh` |
| 添加域名 | `ing-add` → `ing-zone` / `ing-mode` / `ing-prefix` / `ing-domain` / `ing-port` / `ing-preset` / `ing-extra` / `ing-submit` |
| 二次确认 Ingress | `ing-second-ok` / `ing-second-cancel` |
| 域名表 / 行 | `ing-table` / `ing-row` |
| 操作历史表 / 行 | `ws-audit-table` / `ws-audit-row` |

角色门：

- viewer 不能申请机器
- developer 创建通常需审批；owner/admin 可直建
- 升配：admin 可直接生效（视实现），降配一律审批
- SSH：成员 + `ssh_access=granted` + 机器 running/fabric_degraded；否则只显示申请入口
- 销毁：项目 admin 初审 → 平台终审（`nav-dangerous`）

相关 E2E：`web/e2e/pw4-workspaces/`。

---

## 成员与邀请

### 怎么进入

- 全局：侧栏 `nav-members` → `/members`，先用 `member-project` 选项目
- 项目内：`project-tab-members` → `/projects/:id/members`
- 接受邀请：`/invitations/accept`（成员页链接 `invite-accept-page`）

### 子功能

- 添加已有用户、邮件邀请、批量创建用户（平台管理员也可从全局入口开）
- 改角色、SSH 开关、移除、申请 SSH
- 粘贴邀请 token 接受加入

### 快捷键

无。

### 选择器

| 用户看到的 | testid |
|---|---|
| 全局批量创建用户 | `global-batch-create-open` | `platform_admin` |
| 前往用户列表 | `users-page-link` | `platform_admin` |
| 接受邀请页链接 | `invite-accept-page` | |
| 项目下拉 | `member-project` | |
| 添加成员 | `member-add-open` → `member-add-form` / `member-username` / `member-role` / `member-add` |
| 邮件邀请 | `invite-open` → `invite-form` / `invite-email` / `invite-role` |
| 邀请 token / 复制 / 去接受 | `invite-token` / `invite-copy` / `invite-accept-link` |
| 申请 SSH | `member-request-ssh` |
| 批量创建 | `batch-create-open` → `batch-create-dialog` / `batch-create-textarea` / `batch-create-default-password` / `batch-create-role-select` / `batch-create-project-select` / `batch-create-submit` / `batch-create-result` |
| 错误 | `member-error` |
| 角色说明 | `role-help` |
| 成员表 / 行 | `member-table` / `member-row` |
| 行内角色 / SSH / 移除 | `member-role-select` / `member-ssh-toggle` / `member-remove` |
| 接受页 token / 提交 / 对错 | `accept-token` / `accept-submit` / `accept-ok` / `accept-error` |

角色门：添加/改角色/批 SSH 需项目 admin+；viewer 只读。非成员看不见项目。

相关 E2E：`web/e2e/pw3-members/`。

---

## 用户与团队（平台账号）

### 怎么进入

侧栏 `nav-users` → `/users`。仅 `platform_admin`。成员页说明里的 `users-page-link` 也可进。

口头词：用户说「用户列表 / 团队管理 / 批量开号 / 重置密码 / 删除用户」= 本页。项目内加人仍走「成员」。

### 子功能

- 查看全部平台账号与所属项目
- 搜索姓名 / 用户名 / 邮箱 / ID
- 批量创建用户（可选同时加入项目；格式：用户名 邮箱 [姓名] [密码]）
- 配置账号：姓名、平台角色、停用 / 恢复、加入项目
- 重置密码（生成一次性新密码，旧会话立即失效）
- 删除用户（软删；项目负责人须先转让）

### 快捷键

无。

### 选择器

| 用户看到的 | testid | 角色门 |
|---|---|---|
| 侧栏「用户」 | `nav-users` | `platform_admin` |
| 搜索 | `users-search` | |
| 刷新 | `users-refresh` | |
| 批量创建 | `users-batch-create-open` → `batch-create-dialog` | |
| 用户表 / 行 | `users-table` / `users-row` | |
| 复制 ID | `users-copy-id` | |
| 配置账号 | `users-configure` → `users-configure-dialog` / `users-configure-form` / `users-configure-display-name` / `users-configure-role` / `users-configure-submit` / `users-toggle-status` | |
| 加入项目 | 配置弹窗内 `users-add-to-project` → `users-add-dialog` / `users-add-form` / `users-add-project` / `users-add-role` / `users-add-submit` | |
| 重置密码 | `users-reset-password` → `users-reset-dialog` / `users-reset-submit` / `users-reset-copy` | |
| 删除用户 | `users-delete` → `users-delete-dialog`，确认 `confirm-ok` / `confirm-cancel` | |
| 无权 | `users-forbidden` | 非 `platform_admin` |

相关 E2E：`web/e2e/pw5-ops/users.spec.ts`。

---

## SSH 公钥（个人设置）

### 怎么进入

侧栏 `nav-keys` → `/settings/keys`。

### 子功能

添加公钥、复制指纹、删除。机器页也可「导入公钥」（`ws-import-key`），写入同一用户钥匙串。

### 快捷键

无。

### 选择器

| 用户看到的 | testid |
|---|---|
| 添加公钥 | `keys-add-open` |
| 名称 / 公钥 | `keys-name` / `keys-pubkey` |
| 提交 | `keys-add` |
| 行 | `keys-row` |
| 复制 / 删除 | `keys-copy` / `keys-remove` |
| 确认删除 | `confirm-ok` / `confirm-cancel` |

角色门：已登录即可管自己的钥匙。无钥匙时一键 SSH 会走导入/回退。

相关 E2E：`web/e2e/pw5-ops/ssh-keys.spec.ts`。

---

## 节点（宿主机）

### 怎么进入

侧栏 `nav-nodes` → `/nodes`。

### 子功能

刷新、生成加入命令（join token）、对账 reconcile、看 Ready 行。

### 快捷键

无。

### 选择器

| 用户看到的 | testid |
|---|---|
| 刷新 | `nodes-refresh` |
| 一键加入命令 | `nodes-join-token-open`（打开即自动生成） |
| 公网 S3 / 局域网 Depot | `join-depot-public` / `join-depot-lan` |
| 重新生成 / 命令 / 复制 | `join-generate` / `join-command` / `join-copy` |
| 对账 | `nodes-reconcile` |
| 指标卡 | `nodes-metrics-cards` |
| 节点行 / Ready | `node-row` / `node-ready` |

角色门：`platform_admin` / `platform_ops` 可见页；生成 join token 仅 `platform_admin`。

相关 E2E：`web/e2e/pw5-ops/nodes.spec.ts`。

---

## 容量

### 怎么进入

侧栏 `nav-capacity` → `/capacity`。

### 子功能

按架构看空闲 CPU/内存/磁盘；刷新。只读。

### 快捷键

无。

### 选择器

| 用户看到的 | testid |
|---|---|
| 刷新 | `capacity-refresh` |
| 表 / 行 | `capacity-table` / `capacity-row` |
| 空态 | `empty-state`（无池时为文案卡，不一定走 Empty 组件） |

角色门：`platform_admin` / `platform_ops`。

相关 E2E：`web/e2e/pw5-ops/capacity.spec.ts`。

---

## 审计

### 怎么进入

侧栏 `nav-audit` → `/audit`。

### 子功能

刷日志、平台对账 reconcile、看行（操作人、动作、资源）。

### 快捷键

无。

### 选择器

| 用户看到的 | testid |
|---|---|
| 无权限页 | `audit-forbidden` |
| 刷新 / 对账 | `audit-refresh` / `audit-reconcile` |
| 表 / 行 / 操作人 | `audit-table` / `audit-row` / `audit-actor` |

角色门：`platform_admin` / `platform_ops`。reconcile 仅 `platform_admin`。

相关 E2E：`web/e2e/pw5-ops/audit.spec.ts`。

---

## 危险待审（销毁终审）

### 怎么进入

侧栏 `nav-dangerous` → `/dangerous-approvals`。

### 子功能

查看待平台终审的销毁；打开确认后批准。

### 快捷键

无。**不要跳过确认 Dialog。**

### 选择器

| 用户看到的 | testid |
|---|---|
| 表 / 行 | `dangerous-approvals-table` / `dangerous-approval-row` |
| 打开终审 | `dangerous-approve-open` |
| 取消 / 确认终审 | `dangerous-cancel` / `dangerous-confirm` |

角色门：终审后端 `platform_admin`（或已委派的危险操作权）。项目 admin 只能初审（服务器行 `ws-destroy-approve-project`）。

---

## 镜像仓库

### 怎么进入

侧栏 `nav-docker-registries` → `/docker-registries`。

### 子功能

添加私有 Registry、测连通、开关自动注入、删除。

### 快捷键

无。

### 选择器

| 用户看到的 | testid |
|---|---|
| 刷新 / 添加 | `registries-refresh` / `registries-add-open` |
| 名称 / 地址 / 用户 / 密码 | `registries-name` / `registries-server` / `registries-username` / `registries-password` |
| 提交添加 | `registries-submit` |
| 表 / 行 | `registries-table` / `registries-row` |
| 自动注入 / 测连通 / 删除 | `registries-inject-toggle` / `registries-test` / `registries-delete` |
| 确认删除 | `confirm-ok` / `confirm-cancel` |

角色门：`platform_admin`。

---

## 域名配置

### 怎么进入

侧栏 `nav-ingress-domains` → `/ingress-domains`。

### 子功能

添加域名后缀、启用/停用、删除；免审域可开放随机/自定义前缀。

### 快捷键

无。

### 选择器

| 用户看到的 | testid |
|---|---|
| 刷新 / 添加 | `ing-zone-refresh` / `ing-zone-create` |
| 后缀 / 名称 | `ing-zone-suffix` / `ing-zone-name` |
| 提交添加 | `ing-zone-submit` |
| 表 / 行 | `ing-zone-table` / `ing-zone-row` |
| 启用切换 / 删除 | `ing-zone-toggle` / `ing-zone-delete` |

角色门：`platform_admin`。

---

## 通用控件

| 用户看到的 | testid |
|---|---|
| 分页器 | `paginator` |
| 页面加载 | `page-loading` / `page-skeleton` |
| 空态卡片 | `empty-state` |
| 顶栏错误条 | `error-banner` |
| Select / Combobox 触发器 | 组件的 `testId` 属性（如 `ws-plan-select`）；选项 `[role=option][data-value=…]` |
| 确认框 | `role=alertdialog` + `confirm-ok` / `confirm-cancel` |

---

## Agent 验收最短路径

1. **项目 → 服务器**：登录 → `nav-projects` → `project-detail`（不要点行中央，会点到复制 ID）→ 桌面 `[data-testid=project-subnav] [data-testid=project-tab-workspaces]` → `ws-create` 或已有 `ws-row`。
2. **节点加入命令**：`platform_admin` → `nav-nodes` → `nodes-join-token-open`（自动出命令）→ `join-copy`。
3. **网页终端 / 一键 SSH**：`ws-row` running → `ws-web-terminal` 或 `ws-copy-ssh`；详情则 `ws-nav-connect` / `ws-tab-connect`。
4. **销毁终审**：项目初审后 → `nav-dangerous` → `dangerous-approve-open` → `dangerous-confirm`。
