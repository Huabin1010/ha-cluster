# 15 · Playwright 本地 E2E 测试计划

> 上级：[00-index.md](00-index.md)  
> UI/QA 分工：[14-ui-and-qa-tasks.md](14-ui-and-qa-tasks.md)  
> 用例来源：`docs/qa/Q1-auth.md` … `Q5-ssh.md`  
> 更新：2026-09-06（v2：按 `ha-api` / `web` 实际代码核对后修订）  
> 原则：**全部在本地跑通**（`ha-api` 内存账本 + 内存 runtime + `web` Vite dev），不依赖真实 Incus、EasyTier、Bastion SSH；边界场景用 **API 种子 + `page.route` mock** 补齐。

---

## 0. 文档目的

在 [14](14-ui-and-qa-tasks.md) 已定义「测什么」（Q1–Q5 手工/API 单测）的基础上，本文件规定：

1. **如何用 Playwright 把控制台 UI 与交互自动化**；
2. **拆成 5 个互不重叠的子任务**（与 U1–U5 页面对齐，一人一块目录）；
3. **本地一键环境、目录结构、用例编号、断言标准、缺陷分级**；
4. **测试完成后的分析报告模板**（覆盖率、缺口、flaky 记录）。

**不在本计划内：**

- 改 OpenResty / 安全组 / `packaging/`（属 [13](13-remaining-tasks.md) T1–T5）；
- 真 SSH 进容器（Q5-10/11，等 T5 后另开 `e2e-staging` 套件）；
- 替代 Go API 单测（Playwright 只覆盖「用户可见路径」）；
- 修改 Go 业务逻辑（E2E 发现的后端问题记入报告，另开任务）。

### 0.1 v2 修订摘要（相对 v1）

| 类别 | v1 假设 | 代码实际 | 处理 |
|------|---------|----------|------|
| 种子 | `HA_SEED=1` 才建 admin | **默认种子**，仅 `HA_SEED=0` 关闭；同时种子两个节点 `dev-pc`(amd64) / `phone1`(arm64) | §2.1 改写；「空节点」用例改为「种子节点可见」 |
| runtime | 内存 runtime 自动 | 本机有 `incus` 二进制时会选真 Incus | **必须 `HA_RUNTIME=memory`** |
| heartbeat | 需 admin token；字段 `mem_total_bytes` | **无鉴权**；字段为 `allocatable_*_bytes`；`DisallowUnknownFields`（未知字段 400）；总是 `Ready=true` | §5.1 改字段；Ready=false 用 mock |
| 错误体 | `{error:{code,message}}` | 扁平 `{"error":"INSUFFICIENT_CAPACITY"}`；无 arch 专用码 | 断言前端 `friendlyError` 中文 |
| API 路径 | `/projects/{id}/budget`、`/workspaces/{id}/destroy`、`/ssh-keys`、`/audit` | `PATCH /projects/{id}`、`DELETE /workspaces/{id}`、`/me/ssh-keys`、`GET /audit-logs` | `helpers/api.ts` 对齐 |
| 会话 | 共享 `storageState` 文件 | refresh 轮换后旧 token 立即失效，多 worker 共享会互踢 | **worker 级独立登录** |
| 并发 | `fullyParallel` 全量 | 占满容量用例会影响其他 worker | 独立 project `capacity-serial` 最后串行跑 |
| Web | dev/preview | `vite preview` 无 `/api` 反代 | 只用 `npm run dev` |
| Vitest | — | 默认 include `**/*.spec.ts`，会吞掉 e2e | `vite.config.ts` 排除 `e2e/**` |
| Toast | `toast-message` | 复用 `Banner`，testid 为 `error-banner`，宿主 `toast-host` | 断言 `[data-testid=toast-host] [data-testid=error-banner]` |

---

## 1. 范围与五子任务总览

```
┌─────────────────────────────────────────────────────────────────┐
│  本地 Playwright E2E（本文件 PW-1 … PW-5）                        │
├──────────────┬──────────────────┬─────────────────────────────────┤
│ 子任务       │ 对应 UI / QA     │ 独占 spec 目录                   │
├──────────────┼──────────────────┼─────────────────────────────────┤
│ PW-1 壳与会话│ U1 + Q1 UI 部分  │ e2e/pw1-auth-shell/             │
│ PW-2 项目    │ U2 + Q2 项目侧   │ e2e/pw2-projects/               │
│ PW-3 成员邀请│ U3 + Q2 RBAC UI  │ e2e/pw3-members/                │
│ PW-4 Workspace│ U4 + Q3 UI 部分 │ e2e/pw4-workspaces/             │
│ PW-5 运维页  │ U5 + Q4/Q5 UI    │ e2e/pw5-ops/                    │
└──────────────┴──────────────────┴─────────────────────────────────┘
         共享：e2e/fixtures/  e2e/helpers/  e2e/global-setup.ts  playwright.config.ts
```

| 子任务 | 一句话 | 用例数 | 建议工期 |
|--------|--------|--------|----------|
| **PW-1** | 登录/注册/会话/Layout/窄屏/401 跳转 | 18 | 1–1.5 天 |
| **PW-2** | 项目列表/创建/详情/预算/用量/预算拦截 | 13 | 1 天 |
| **PW-3** | 成员 CRUD、邀请、接受、角色权限 UI | 16 | 1–1.5 天 |
| **PW-4** | Workspace 创建/启停/销毁/409/SSH 下载 | 20 | 1.5–2 天 |
| **PW-5** | 节点/容量/公钥/审计/对账 | 16 | 1 天 |

**合计：83 条**（含 `@smoke` 约 22 条、`@responsive` 2 条、`@capacity` 6 条）。

---

## 2. 本地环境（唯一支持的目标）

### 2.1 进程拓扑

```
浏览器 (Playwright Chromium)
    │  baseURL http://127.0.0.1:5173
    ▼
Vite dev server (:5173)  ──proxy /api/* → /*──►  ha-api (:8080, memory store + memory runtime)
```

| 组件 | 命令 | 端口 | 说明 |
|------|------|------|------|
| API | `HA_RUNTIME=memory go run ./cmd/ha-api` | 8080 | 默认种子：`admin` / `adminadmin`（`platform_admin`）+ 节点 `dev-pc`、`phone1` |
| Web | `cd web && npm run dev` | 5173 | `/api` 反代见 `web/vite.config.ts`（rewrite 去掉 `/api`） |
| E2E | `cd web && npm run test:e2e` | — | `webServer` 自动拉起上述两者（已在跑则复用） |

**种子与内存账本特性（测试利用点）：**

- 只有 `HA_SEED=0` 才跳过种子；E2E **依赖**种子 admin 与两个节点：
  - `dev-pc`：amd64，8000 mCPU / 8 GiB / 200 GiB，`power=mains`，`fabric_ip=10.88.0.30`
  - `phone1`：arm64，2000 mCPU / 1800 MiB / 40 GiB，`power=battery`，`fabric_ip=10.88.0.10`
- `global-setup` 再 heartbeat 两台**大容量池节点** `e2e-pool-amd64` / `e2e-pool-arm64`（各 16000 mCPU / 16 GiB / 500 GiB，`power=battery`），避免并行用例把种子节点吃光；
- `HA_RUNTIME=memory` 时 `POST /projects/{id}/workspaces` **同步**返回 `running`，无异步状态；
- 重启 API 数据清空；`reuseExistingServer` 时数据**跨次运行保留**，因此所有种子必须幂等、所有名字带唯一后缀；
- `POST /nodes/heartbeat` 无鉴权，按 `name` upsert；**注意**：heartbeat 会用请求体覆盖 `used_*`（后端已知问题，见 §9 报告 P1），所以 E2E 只 heartbeat 自己的节点（`e2e-*`），且 PW-5 的心跳测试节点用 `role: "control-plane"`（调度与容量池都会跳过它，不影响其他用例）。

### 2.2 环境变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `E2E_BASE_URL` | `http://127.0.0.1:5173` | Playwright `baseURL` |
| `E2E_API_URL` | `http://127.0.0.1:8080` | fixture 直连 API（不经 Vite proxy） |
| `HA_RUNTIME` | `memory`（由 config 注入） | 强制内存 runtime，本机装了 incus 也不碰 |
| `HA_SEED` | 未设（=种子） | 不要设为 `0` |
| `CI` | — | 存在时 `retries: 2`、`workers: 1`、不复用已有服务 |

### 2.3 账号与种子（扩展 [fixtures.md](../qa/fixtures.md)）

| 用户名 | 密码 | 角色 | 谁创建 |
|--------|------|------|--------|
| `admin` | `adminadmin` | platform_admin | API 默认种子 |
| `qa_owner` | `password1` | 普通用户 → 各测试项目 owner | `e2e/global-setup.ts`（409 视为已存在） |
| `qa_dev` | `password1` | developer 成员 | 同上 |
| `qa_viewer` | `password1` | viewer 成员 | 同上 |
| `e2e_<prefix>_<ts>` | `password1` | 一次性新用户（空态用例） | 用例内 `freshUser()` |

**会话约定（关键）：**

- access token 15 分钟；refresh 30 天且**轮换**（用一次即失效）。
- 每个 **worker** 通过 API 各自登录 4 个角色，拿到独立 token 对，缓存在 worker fixture；超过 10 分钟自动重登。
- 每个测试通过 `pageAs(role)` 获得一个**新 BrowserContext**，用 `storageState`（内存对象，不落盘）注入 `localStorage`：`ha_token` / `ha_refresh` / `ha_user`。不写 `e2e/.auth/*.json`。
- 需要多用户时在同一测试调用多次 `pageAs()`。

### 2.4 一键命令

```bash
cd web
npm install
npx playwright install chromium   # 首次

npm run test:e2e                  # 全量（自动拉起 API + Vite）
npm run test:e2e:smoke            # @smoke
npm run test:e2e:pw4              # 单个子任务
npm run test:e2e -- --project=chromium e2e/pw1-auth-shell/login.spec.ts
npm run test:e2e:report           # 打开 HTML 报告
```

手动起服务（调试更快，Playwright 会复用）：

```bash
export PATH="$HOME/.local/go/bin:$PATH"
HA_RUNTIME=memory go run ./cmd/ha-api      # 终端 1
cd web && npm run dev                      # 终端 2
```

---

## 3. 工程结构

```
web/
├── playwright.config.ts
├── e2e/
│   ├── global-setup.ts          # 等 healthz；幂等注册 qa_*；heartbeat e2e-pool-*
│   ├── fixtures/
│   │   ├── auth.ts              # test = base.extend：sessions(worker) + pageAs/ownerPage/…(test)
│   │   └── seed.ts              # seedProject / seedWorkspace / fillArch 等 API 种子
│   ├── helpers/
│   │   ├── api.ts               # fetch 到 E2E_API_URL，路径与后端一致
│   │   ├── assert.ts            # expectToast / expectBannerError / expectNoHorizontalOverflow
│   │   └── ids.ts               # uniq(prefix) → 唯一 slug / 名称
│   ├── pw1-auth-shell/{login,session,layout,responsive}.spec.ts
│   ├── pw2-projects/{list-create,detail-usage,budget}.spec.ts
│   ├── pw3-members/{member-crud,invite-accept,rbac-ui}.spec.ts
│   ├── pw4-workspaces/{create-list,lifecycle,ssh-download,insufficient}.spec.ts
│   └── pw5-ops/{nodes,capacity,ssh-keys,audit-reconcile}.spec.ts
└── package.json                 # @playwright/test、test:e2e* 脚本
```

产物目录 `web/test-results/`、`web/playwright-report/`、`web/blob-report/` 已加入根 `.gitignore`。

### 3.1 `playwright.config.ts` 要点

```typescript
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const CI = !!process.env.CI;
const WEB = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8080";
const goBin = path.join(process.env.HOME ?? "", ".local", "go", "bin");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: WEB,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, grepInvert: /@responsive|@capacity/ },
    { name: "mobile", use: { ...devices["Pixel 5"] }, grep: /@responsive/ },
    // 占满容量 / 对账类用例：最后、串行
    { name: "capacity-serial", use: { ...devices["Desktop Chrome"] }, grep: /@capacity/,
      fullyParallel: false, dependencies: ["chromium"] },
  ],
  webServer: [
    {
      command: "go run ./cmd/ha-api",
      cwd: path.resolve(__dirname, ".."),
      url: `${API}/healthz`,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: { ...process.env, HA_RUNTIME: "memory", HA_API_ADDR: ":8080", PATH: `${goBin}:${process.env.PATH}` },
    },
    { command: "npm run dev", url: WEB, reuseExistingServer: !CI, timeout: 60_000 },
  ],
});
```

### 3.2 用例标签

| 标签 | 含义 |
|------|------|
| `@pw1` … `@pw5` | 子任务归属 |
| `@smoke` | PR 必跑（每子任务 3–5 条） |
| `@responsive` | 窄屏；只在 `mobile` project 跑 |
| `@capacity` | 会占满节点容量或触发对账；只在 `capacity-serial` project 跑 |
| `@slow` | 多用户切换等较慢用例（仅标记） |

`package.json` 脚本：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:e2e": "playwright test",
    "test:e2e:pw1": "playwright test --grep @pw1",
    "test:e2e:pw2": "playwright test --grep @pw2",
    "test:e2e:pw3": "playwright test --grep @pw3",
    "test:e2e:pw4": "playwright test --grep @pw4",
    "test:e2e:pw5": "playwright test --grep @pw5",
    "test:e2e:smoke": "playwright test --grep @smoke",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:report": "playwright show-report"
  }
}
```

`vite.config.ts` 必须排除 e2e：

```typescript
import { configDefaults } from "vitest/config";
test: { environment: "jsdom", globals: true, exclude: [...configDefaults.exclude, "e2e/**"] }
```

---

## 4. 选择器策略与 `data-testid` 登记

**优先级：** `data-testid` > `getByRole` + 中文文案 > CSS class。中文文案只用于断言内容，不用于定位（避免改文案即碎）。

### 4.1 已有 testid（代码中存在）

| testid | 页面 |
|--------|------|
| `login-username` / `login-password` / `login-submit` / `login-error` / `login-info` | Login |
| `nav-projects` / `current-user` | Layout |
| `page-loading` / `page-skeleton` / `error-banner` / `empty-state` | ui |
| `project-create-form` / `project-name` / `project-slug` / `project-create` / `project-row` / `project-error` | Projects |
| `project-id` / `project-usage` / `budget-cpu` / `budget-mem` / `budget-disk` / `budget-save` / `project-error` | Project Detail |
| `member-project` | Members |
| `role-help` / `member-error` / `member-add-form` / `member-username` / `member-role` / `member-add` / `member-table` / `member-row` / `member-remove` | MemberList |
| `invite-form` / `invite-email` / `invite-role` / `invite-token` / `invite-copy` / `invite-accept-link` | MemberList |
| `accept-token` / `accept-submit` / `accept-error` / `accept-ok` | AcceptInvite |
| `ws-create` / `ws-row`（含 `data-status`）/ `ws-error` / `ws-ssh-download` | Workspaces |
| `node-ready`（class `badge-ok|badge-warn|badge-danger`） | Nodes |
| `keys-add` | SSHKeys |
| `audit-forbidden` | Audit |

### 4.2 本计划新增（阶段 2 一次补齐，仅加属性不改逻辑）

| testid | 位置 |
|--------|------|
| `nav-toggle` / `env-badge` / `logout-button` | Layout（`env-badge` 顶栏与侧栏各一，按视口只有一个可见） |
| `nav-members` / `nav-workspaces` / `nav-nodes` / `nav-capacity` / `nav-keys` / `nav-audit` | Layout NavLink |
| `project-copy-id` | Projects 行按钮、Detail 头部按钮 |
| `project-goto-workspaces` / `project-goto-members` | Detail 链接 |
| `ws-submit` / `ws-start` / `ws-stop` / `ws-destroy` / `ws-copy-id` | CreateForm 提交、WorkspaceRow 按钮 |
| `node-row` / `nodes-reconcile` | Nodes |
| `capacity-row` | Capacity |
| `audit-table` / `audit-reconcile` | Audit |
| `keys-row` / `keys-remove` | SSHKeys |
| `toast-host` | Toast 宿主（内部仍是 `error-banner`） |

---

## 5. 共享 Fixture 设计

### 5.1 `helpers/api.ts`（路径与后端一致）

```typescript
register(username, email, password)            // POST /auth/register  201 / 409 conflict / 400
login(username, password)                      // POST /auth/login → { token, refresh_token, user }
logout(refresh_token)                          // POST /auth/logout  204
me(token)                                      // GET /me
createProject(token, { name, slug })           // POST /projects
patchProject(token, id, { budget_cpu_milli, budget_mem_bytes, budget_disk_bytes })  // PATCH /projects/{id}
usage(token, id)                               // GET /projects/{id}/usage
addMember(token, pid, { username, role })      // POST /projects/{id}/members
createInvitation(token, pid, { email, role })  // POST /projects/{id}/invitations → { token }
acceptInvite(token, inviteToken)               // POST /invitations/accept
createWorkspace(token, pid, { name, plan, arch, visibility })  // POST /projects/{id}/workspaces
listWorkspaces(token, pid?)                    // GET /workspaces?project_id=
stopWorkspace / startWorkspace(token, id)      // POST /workspaces/{id}/stop|start
destroyWorkspace(token, id)                    // DELETE /workspaces/{id}
heartbeat(node)                                // POST /nodes/heartbeat（无鉴权）
listNodes(token) / capacity(token)             // GET /nodes, GET /capacity → { nodes, pools }
addSSHKey / deleteSSHKey                       // /me/ssh-keys
reconcile(adminToken)                          // POST /admin/reconcile → { released, stale_nodes }
```

heartbeat 请求体只能用 `models.Node` 的字段：

```typescript
await heartbeat({
  name: "e2e-pool-amd64", arch: "amd64", class: "desktop", power: "battery", role: "worker",
  fabric_ip: "10.88.0.201", fabric_path: "p2p", fabric_rtt_ms: 5,
  allocatable_cpu_milli: 16000, allocatable_mem_bytes: 16 * 1024 ** 3, allocatable_disk_bytes: 500 * 1024 ** 3,
});
```

### 5.2 `fixtures/auth.ts`

```typescript
type Role = "admin" | "owner" | "dev" | "viewer";
export const test = base.extend<
  { pageAs: (role: Role) => Promise<Page>; ownerPage: Page; adminPage: Page; devPage: Page; viewerPage: Page;
    freshUser: (prefix: string) => Promise<{ username: string; page: Page; token: string }> },
  { sessions: SessionCache }   // worker 级：按角色缓存 token 对，>10min 重登
>({ /* … */ });
```

`pageAs(role)` = `browser.newContext({ storageState: { cookies: [], origins: [{ origin: baseURL, localStorage: [ha_token, ha_refresh, ha_user] }] }, permissions: ["clipboard-read", "clipboard-write"] })` → `newPage()`；测试结束统一关闭。

### 5.3 `fixtures/seed.ts`

```typescript
seedProject(ownerToken, prefix)                       // 唯一 slug e2e-<prefix>-<ts>-<rand>
seedProjectWithMembers(ownerToken, prefix)            // + qa_dev(developer) + qa_viewer(viewer)
seedWorkspace(token, pid, { plan = "nano", arch = "amd64", name })
fillArch(token, pid, arch)                            // 循环 xlarge→…→nano 直到 409，返回创建的 ws id 列表
destroyAll(token, ids)
```

### 5.4 下载断言（SSH config）

前端用 Blob + `<a download>`，Playwright 默认 `acceptDownloads: true`：

```typescript
const [download] = await Promise.all([
  page.waitForEvent("download"),
  row.getByTestId("ws-ssh-download").click(),
]);
const text = await fs.readFile(await download.path(), "utf8");
expect(text).toContain("Host ha-");
expect(text).toContain("RemoteCommand");
```

### 5.5 对话框

销毁 Workspace、移除成员、删除公钥都用原生 `window.confirm`。Playwright **默认自动 dismiss**（等价取消）；需要确认时：

```typescript
page.once("dialog", (d) => d.accept());
```

### 5.6 `page.route` mock 约定

只对**后端无法在内存模式下制造**的状态使用 mock：`fabric_degraded`（PW4-18）、`ready=false` / `path=stale`（PW5-03）、`/api/me` 503（PW1-17）、慢响应制造 loading（PW1-16、PW4-15、PW5-14）。pattern 用 `**/api/<path>**`（浏览器侧路径带 `/api` 前缀）。

---

# 子任务 PW-1 · 壳子、登录与会话

> **独占目录：** `e2e/pw1-auth-shell/`  
> **对应：** U1、[Q1-auth.md](../qa/Q1-auth.md) Q1-11 及会话相关  
> **注意：** DEV 构建登录表单**预填** `admin/adminadmin`，错密用例先清空。

## PW-1 用例清单

| ID | 标签 | 标题 | 步骤 | 期望 | 映射 Q |
|----|------|------|------|------|--------|
| PW1-01 | @pw1 @smoke | 错密登录 | 清空后填 admin / wrong | `login-error` 含「用户名或密码错误」；仍在 `/login` | Q1-11 |
| PW1-02 | @pw1 @smoke | 正确登录 | admin 登录 | URL `/projects`；`current-user` 含 admin | Q1-04 |
| PW1-03 | @pw1 | 注册新用户 | 展开注册 → 填唯一用户名/邮箱/密码 → 创建账号 | `login-info` 含「注册成功」；随后可登录 | Q1-01 |
| PW1-04 | @pw1 | 注册冲突 | 用 `qa_owner` 再注册 | `login-error` 含「冲突」 | Q1-02 |
| PW1-05 | @pw1 | 密码过短 | 注册 password=`123` | `login-error` 含「输入无效」 | Q1-03 |
| PW1-06 | @pw1 @smoke | 未登录访问受保护页 | 直接 `/workspaces` | 重定向 `/login`（无 query） | — |
| PW1-07 | @pw1 | 已登录访问 /login | `pageAs(owner)` 进 `/login` | 重定向 `/projects` | U1 |
| PW1-08 | @pw1 | 退出 | 点 `logout-button` | 回 `/login`；再访问 `/projects` 被拒 | Q1-09 |
| PW1-09 | @pw1 | 清 token 强刷 | 删 `ha_token`/`ha_refresh` 后 reload | 回 `/login`（无 query） | U1 |
| PW1-10 | @pw1 | 过期提示 | 访问 `/login?reason=expired` | `login-info` 含「过期」 | U1 |
| PW1-11 | @pw1 @slow | refresh 轮换 UI | a) 伪造 `ha_token` + 有效 refresh → 进 `/projects`：刷新成功、页面正常；b) 伪造 token + 已 logout 的 refresh → `/login?reason=expired` | 两条断言均成立 | Q1-08 |
| PW1-12 | @pw1 | 侧栏导航 | 依次点 7 个 `nav-*` | URL 正确；主区 `h2` 文案匹配 | U1 |
| PW1-13 | @pw1 | 环境角标 dev | 登录后 | 可见 `env-badge` 文案 `dev` | U1 |
| PW1-14 | @pw1 @responsive | 窄屏菜单 | Pixel 5；点 `nav-toggle` | `.shell.nav-open`；点遮罩（`关闭菜单`）后关闭 | U1 |
| PW1-15 | @pw1 @responsive | 窄屏不横向溢出 | 逐页访问 | `document.documentElement.scrollWidth <= innerWidth` | U1 |
| PW1-16 | @pw1 | 加载态 | 延迟 `/api/projects` 800ms | 期间 `page-loading` 可见；随后 `h2` 出现 | U1 |
| PW1-17 | @pw1 | 网络错误保壳 | `/api/me` 置 503 | 仍在 `/projects`；`ha_token` 未清 | U1 |
| PW1-18 | @pw1 | 表单 a11y | 焦点从 username 起按 Tab | 顺序 username → password → submit；`login-error` 有 `role=alert` | U1 |

## PW-1 DoD

- [ ] `e2e/pw1-auth-shell/*.spec.ts` 全绿（chromium + mobile）
- [ ] `fixtures/auth.ts` 供 PW-2–5 复用
- [ ] 报告 `docs/qa/reports/pw1-summary.md`

---

# 子任务 PW-2 · 项目与预算

> **独占目录：** `e2e/pw2-projects/`  
> **对应：** U2、[Q2-rbac.md](../qa/Q2-rbac.md) Q2-01/02/09  
> **注意：** 创建成功后前端**直接跳详情页**，不是停留列表。

## PW-2 用例清单

| ID | 标签 | 标题 | 步骤 | 期望 | 映射 Q |
|----|------|------|------|------|--------|
| PW2-01 | @pw2 @smoke | 空态 | `freshUser` 进 `/projects` | `empty-state` 含「还没有项目」 | U2 |
| PW2-02 | @pw2 @smoke | 创建项目 | 填名称 + slug 提交 | 跳 `/projects/:id`，`project-id` 可见；回列表有 `project-row` 含名称 | Q2-01 |
| PW2-03 | @pw2 | slug 非法 | slug=`Bad Slug` | 浏览器约束校验拦截：`project-slug` 为 `:invalid`，无请求，仍在 `/projects` | U2 |
| PW2-04 | @pw2 | slug 冲突 | API 先建 slug X，UI 再建 X | `project-error` 含「已被占用」 | Q2-02 |
| PW2-05 | @pw2 @smoke | 进入详情 | 点 `project-row` | URL `/projects/:id`；`project-id` = id | U2 |
| PW2-06 | @pw2 | 用量展示 | API 建 1 台 nano 后进详情 | `project-usage` 含 Workspace=1；CPU/内存/磁盘与 `GET /usage` 一致 | U2 |
| PW2-07 | @pw2 | 编辑预算 | 改 `budget-mem` 保存 | 文案「预算已保存」；reload 后值仍在 | U2 |
| PW2-08 | @pw2 | 预算 0=不限 | 三项填 0 保存 | 「预算已保存」；显示「不限」 | U2 |
| PW2-09 | @pw2 @smoke | 预算拦截 | API `PATCH budget_mem_bytes=1` → `/workspaces?project_id=` 建 nano | `ws-error` 含「资源不足」；banner 有 `ws-insufficient` | Q2-09 |
| PW2-10 | @pw2 | 去创建 Workspace 链 | 点 `project-goto-workspaces` | URL `/workspaces?project_id=<id>` | U2 |
| PW2-11 | @pw2 | 复制项目 id | 点 `project-copy-id` | clipboard = id；按钮文案变「已复制」 | U2 |
| PW2-12 | @pw2 | 列表刷新 | API 建项目后 reload 列表 | 含该名称的 `project-row` | U2 |
| PW2-13 | @pw2 | 长名称 | 120 字符名称 | 详情页 `h2` 完整显示且主区不横向溢出 | 体验 |

## PW-2 DoD

- [ ] 13 条全绿
- [ ] `seedProject` 导出给 PW-3/PW-4
- [ ] Q2-01/02/09 UI 列在 `Q2-rbac.md` 勾选

---

# 子任务 PW-3 · 成员、邀请与 RBAC 界面

> **独占目录：** `e2e/pw3-members/`  
> **对应：** U3、[Q2-rbac.md](../qa/Q2-rbac.md) Q2-05–08、Q2-11  
> **关键：** `/invitations/accept` 是受保护路由，接受方必须**先登录**；后端不校验邮箱与用户匹配。

## PW-3 用例清单

| ID | 标签 | 标题 | 步骤 | 期望 | 映射 Q |
|----|------|------|------|------|--------|
| PW3-01 | @pw3 @smoke | 从项目进成员 | owner `/projects/:id/members` | `member-table` 可见，含 owner 行 | U3 |
| PW3-02 | @pw3 @smoke | query 带入项目 | `/members?project_id=` | `member-project` 值 = id | U3 |
| PW3-03 | @pw3 @smoke | owner 加 developer | 填 `qa_dev` + developer 提交 | `member-row` 数 +1，含「developer」 | Q2-06 |
| PW3-04 | @pw3 | 角色说明 | 打开成员页 | `role-help` 含 viewer/developer/admin/owner | Q2-11 |
| PW3-05 | @pw3 | 生成邀请 | email + role → 生成邀请 | `invite-token` 内 token 非空 | U3 |
| PW3-06 | @pw3 | 邀请链接 | 点 `invite-accept-link` | URL `/invitations/accept?token=<token>`；`accept-token` 已填 | U3 |
| PW3-07 | @pw3 @smoke | 接受邀请 | API 生成 token；`devPage` 打开 accept 页提交 | `accept-ok`；跳 `/projects/:id` | Q2-07 |
| PW3-08 | @pw3 | 错误 token | 乱 token 提交 | `accept-error` 可见 | Q2-08 |
| PW3-09 | @pw3 | 移除成员 | owner 点 `member-remove`（dialog accept） | 行数 -1 | U3 |
| PW3-10 | @pw3 @smoke | viewer 不能加成员 | viewer 尝试添加 | `member-error` 含「没有权限」 | Q2-05 |
| PW3-11 | @pw3 | viewer 不能移除 | viewer 点移除并确认 | `member-error` 含「没有权限」 | U3 |
| PW3-12 | @pw3 | owner 不可表单转让 | 查看 `member-role` 选项 | 无 `owner`；页面含「owner 不可通过此表单转让」 | U3 |
| PW3-13 | @pw3 | 未选项目 | `/members` 无 query | 含「从上方选择项目」 | U3 |
| PW3-14 | @pw3 @slow | 邀请后成员可见项目 | dev 接受后进 `/projects` | 列表含该项目名 | Q2-07 |
| PW3-15 | @pw3 | 重复 accept | API 先 accept；UI 再提交同 token | `accept-error` 含「冲突」 | Q2-08 |
| PW3-16 | @pw3 | 邮箱格式 | `invite-email`=`not-an-email` 提交 | 输入 `:invalid`；无 `invite-token` | 体验 |

## PW-3 DoD

- [ ] 16 条全绿
- [ ] Q2-05/06/07/08/11 UI 列勾选

---

# 子任务 PW-4 · Workspace 生命周期

> **独占目录：** `e2e/pw4-workspaces/`  
> **对应：** U4、[Q3-ledger.md](../qa/Q3-ledger.md) Q3-10 及生命周期、Q5-04/12、Q2-03/04  
> **并发约定：** 所有用例用 `/workspaces?project_id=<自己的项目>` 访问，名字唯一；`@capacity` 用例只在 `capacity-serial` 跑并在 `afterAll` 销毁占位机。

## PW-4 用例清单

| ID | 标签 | 标题 | 步骤 | 期望 | 映射 Q |
|----|------|------|------|------|--------|
| PW4-01 | @pw4 @smoke | 空态 | 新项目 | `empty-state` 含「还没有 Workspace」；`ws-create` 可见 | U4 |
| PW4-02 | @pw4 @smoke | 创建 nano | 项目已带入；plan nano、arch amd64 提交 | `ws-row[data-status=running]`；toast 含「创建成功」 | Q3-01 |
| PW4-03 | @pw4 | 项目 query 筛选 | 两项目各 1 台；`?project_id=A` | 仅 A 的行 | U4 |
| PW4-04 | @pw4 | 中文状态 | 运行中 | 行含「运行中」 | U4 |
| PW4-05 | @pw4 @smoke | 停止 | 点 `ws-stop` | `data-status=stopped`；行含「仍占配额」；toast 含「仍占配额」 | Q3-05 |
| PW4-06 | @pw4 @smoke | 再启动 | 点 `ws-start` | running | U4 |
| PW4-07 | @pw4 @smoke | 销毁 | dialog accept | 行消失；toast 含「配额已归还」 | Q3-06 |
| PW4-08 | @pw4 | 销毁取消 | dialog dismiss | 行仍在 | U4 |
| PW4-09 | @pw4 @capacity | 超卖 409 | API `fillArch(amd64)` → UI 建 nano amd64 | `ws-error` 含「资源不足」；banner `ws-insufficient` | Q3-02 Q3-10 |
| PW4-10 | @pw4 @capacity | arch 隔离 | API `fillArch(arm64)` → UI 建 nano arm64 → 409；再建 nano amd64 | 前者「资源不足」，后者成功 | Q3-03 |
| PW4-11 | @pw4 | visibility private | 创建 private | 行含 `private` | Q2-10 |
| PW4-12 | @pw4 @smoke | 下载 SSH | 点 `ws-ssh-download` | 文件含 `Host ha-`、`RemoteCommand` | Q5-12 |
| PW4-13 | @pw4 | stopped 无 SSH 按钮 | 停止后 | 该行无 `ws-ssh-download` | Q5-04 |
| PW4-14 | @pw4 | 复制 workspace id | 点 `ws-copy-id` | clipboard = id；toast 含「已复制」 | U4 |
| PW4-15 | @pw4 | 创建中 disabled | 延迟 POST 1s | `ws-submit` disabled 且文案「创建中…」 | 体验 |
| PW4-16 | @pw4 | 套餐下拉 | 打开创建表单 | 选项 = nano/small/medium/large/xlarge | Q3-11 |
| PW4-17 | @pw4 @capacity | 停止后再建同规格 | 占满后 stop 一台不 destroy，再建 | 仍「资源不足」 | Q3-05 |
| PW4-18 | @pw4 | fabric_degraded 展示 | mock `GET /api/workspaces` 返回该状态 | 行含「网络降级」；`ws-start`/`ws-stop`/`ws-ssh-download` 均可见 | U4 |
| PW4-19 | @pw4 | viewer 不能创建 | viewerPage 提交 | `ws-error` 含「没有权限」 | Q2-03 |
| PW4-20 | @pw4 | developer 可创建 | devPage 提交 | `ws-row` 出现 | Q2-04 |

## PW-4 DoD

- [ ] 20 条全绿（含 `capacity-serial`）
- [ ] Q3-10、Q5-12、Q2-03/04 UI 列勾选

---

# 子任务 PW-5 · 节点、容量、公钥、审计

> **独占目录：** `e2e/pw5-ops/`  
> **对应：** U5、[Q4-nodes.md](../qa/Q4-nodes.md) Q4-01/02/03/06、[Q5-ssh.md](../qa/Q5-ssh.md) Q5-08  
> **约定：** 心跳测试节点命名 `e2e-node-*`、`role: "control-plane"`；对账用例 `@capacity`（会把超时节点标 stale，放最后）。

## PW-5 用例清单

| ID | 标签 | 标题 | 步骤 | 期望 | 映射 Q |
|----|------|------|------|------|--------|
| PW5-01 | @pw5 @smoke | 种子节点可见 | `/nodes` | 行含 `dev-pc`、`phone1` | Q4 |
| PW5-02 | @pw5 @smoke | 有心跳节点 | API heartbeat `e2e-node-<ts>` → reload | 行出现；`node-ready` 文案 `yes`、class `badge-ok` | Q4-01 |
| PW5-03 | @pw5 | Ready false / stale 样式 | mock `/api/nodes` | `badge-danger`（ready=false）与 `badge-warn`（path=stale）；行 `warn-row` | Q4-06 |
| PW5-04 | @pw5 | 列完整 | heartbeat 带 `fabric_ip/path/rtt` | 三列非空且与种子一致 | U5 |
| PW5-05 | @pw5 @smoke | 容量页 | `/capacity` | `capacity-row` 含 amd64 与 arm64 | Q4-03 |
| PW5-06 | @pw5 | 容量与 API 一致 | `waitForResponse('/api/capacity')` | 每行 `(N milli)` 与响应 `pools[].cpu_milli_free` 一致 | Q4 |
| PW5-07 | @pw5 @smoke | 添加公钥 | name + `ssh-ed25519 AAAA…` 提交 | `keys-row` 出现，fingerprint 64 hex；toast 含「公钥已添加」 | Q5-08 |
| PW5-08 | @pw5 | 删除公钥 | `keys-remove`（dialog accept） | 行消失 | Q5-08 |
| PW5-09 | @pw5 | 空公钥不可提交 | 公钥留空 | `keys-add` disabled（后端不校验格式，记 P2） | Q5-08 |
| PW5-10 | @pw5 @smoke | admin 审计 | adminPage `/audit` | `audit-table` 含 `user.login` | U5 |
| PW5-11 | @pw5 @smoke | 非 admin 审计 | ownerPage `/audit` | `audit-forbidden` | U5 |
| PW5-12 | @pw5 @capacity | 对账按钮 | adminPage `/nodes` 点 `nodes-reconcile` | toast 含「对账完成」 | Q3-09 |
| PW5-13 | @pw5 | 非 admin 无对账 | ownerPage `/nodes` | 无 `nodes-reconcile` | U5 |
| PW5-14 | @pw5 | 审计加载 | 延迟 `/api/audit-logs` | 期间 `page-skeleton` 可见 → 表出现 | U5 |
| PW5-15 | @pw5 | 公钥空态 | `freshUser` `/settings/keys` | `empty-state` | U5 |
| PW5-16 | @pw5 | 节点刷新 | 第二次 heartbeat 改 `fabric_ip` → reload | 该行 IP 更新 | Q4-02 |

## PW-5 DoD

- [ ] 16 条全绿
- [ ] Q4-01/02/03/06、Q5-08 UI 列勾选

---

## 6. 与 Q1–Q5 的覆盖矩阵

| QA 文档 | API/Go 单测 | Playwright 覆盖 | 缺口 |
|---------|-------------|-----------------|------|
| Q1 认证 | Q1-01–10 | PW1 全 UI + PW1-11 会话 | suspend 仅 API |
| Q2 RBAC | 大部分 | PW2 预算、PW3 成员/邀请、PW4 viewer/dev 建机 | private SSH target 仅 API |
| Q3 账本 | Q3-01–09 | PW4 生命周期 + 409（预算 / 节点 / arch） | 并发 32（Go）；reconcile 仅按钮 |
| Q4 节点 | Q4-01–05 | PW5 展示（真心跳 + mock stale） | Q4-07 真 worker → staging |
| Q5 SSH | Q5-01–09 | PW4 下载 + PW5 公钥 | Q5-10/11 真 SSH → staging |

**原则：** API 已测的逻辑，E2E 只抽 **1 条冒烟** 验证 UI 接线；UI 专属（中文状态、toast、403 文案）由 Playwright **全测**。

---

## 7. 执行策略

### 7.1 三层金字塔

```
        ┌─────────────┐
        │  PW E2E     │  83 条，本地，约 2–4 分钟
        ├─────────────┤
        │ Vitest 组件 │  providers、format、roles、types
        ├─────────────┤
        │ Go API 单测 │  账本/RBAC/SSH 核心
        └─────────────┘
```

### 7.2 何时跑

| 时机 | 命令 | 范围 |
|------|------|------|
| 开发中 | `npm run test:e2e:pwN` | 单个子任务 |
| PR | `npm run test:e2e:smoke` | @smoke ~22 条 |
| 合并前 | `npm run test:e2e` | 全量 |
| 发版 | smoke + `go test ./...` + `npm test` + 手工 Q4-07/T5 | 见 14 上线门禁 |

### 7.3 稳定性约定

- 禁止 `waitForTimeout` 固定睡眠；用 web-first 断言（`toBeVisible` / `toHaveAttribute` / `toHaveCount`）、`waitForResponse`；
- 所有项目 / Workspace / 用户名字带 `uniq()` 后缀，可在复用服务上反复跑；
- 会占满节点容量或触发 reconcile 的用例打 `@capacity`，只在 `capacity-serial` 跑，`afterAll` 归还；
- 心跳只打 `e2e-*` 节点，PW-5 的心跳节点 `role=control-plane`；
- flaky 3 次失败 → 记 `docs/qa/reports/flaky.md` 并 `test.fixme`。

---

## 8. CI 集成（可选，第二期）

```yaml
# .github/workflows/e2e.yml 草案（仓库目前没有 .github/）
jobs:
  playwright:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.24" }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd web && npm ci && npx playwright install --with-deps chromium
      # 不要手动 go run &：playwright.config 的 webServer 会拉起 API 与 Vite
      - run: cd web && CI=1 npm run test:e2e:smoke
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: web/playwright-report/ }
```

---

## 9. 测试分析报告模板

每个子任务完成后填 `docs/qa/reports/pwN-summary.md`：

```markdown
# PW-N 测试分析报告

- 日期 / 执行人 / commit
- 环境：local memory ledger + memory runtime
- 结果：Pass X / Fail Y / Skip Z
- 耗时：

## 覆盖率
- 页面路由：□ 全覆盖
- 主按钮/表单：□
- 错误路径：□

## 发现的问题
| 级别 | 描述 | 复现 | issue |
|------|------|------|-------|
| P0/P1/P2 | | PWx-xx | # |

## 交互体验备注
## Flaky
## 与 Q 文档勾选
```

**汇总报告** `docs/qa/reports/playwright-full-run.md`：五子任务全绿后合并一页，供 [14](14-ui-and-qa-tasks.md) 上线门禁引用。

**E2E 阶段已知的后端问题（写入汇总报告，不在本计划修）：**

| 级别 | 问题 | 位置 |
|------|------|------|
| P1 | `Heartbeat` 用请求体覆盖 `used_*`（`UpsertNode` 只在 ID 变化时保留），真实 agent 每次心跳会把账本占用清零 | `internal/service/service.go` `Heartbeat` / `internal/store/memory/memory.go` `UpsertNode` |
| P2 | `POST /me/ssh-keys` 不校验公钥格式，任意字符串都能入库 | `internal/api/server.go` `addKey` |
| P2 | `POST /nodes/heartbeat` 无鉴权 | `internal/api/server.go` |

---

## 10. 排期建议

| 周 | 子任务 | 产出 |
|----|--------|------|
| 1 | 基建 + testid + PW-1 + PW-2 | `playwright.config.ts`、fixtures、pw1/pw2 绿 |
| 2 | PW-3 + PW-4 | 多用户 + Workspace 全链路 + capacity-serial |
| 3 | PW-5 + 全量回归 | ops 页 + 报告 |
| 4 | 修 flaky、CI 草案 | 五份 `pwN-summary.md` + 门禁签字 |

---

## 11. 完成勾选

| 子任务 | spec 目录 | smoke | 全量 | 报告 | 负责人 |
|--------|-----------|-------|------|------|--------|
| PW-1 壳与会话 | `e2e/pw1-auth-shell/` | □ | □ | □ | |
| PW-2 项目 | `e2e/pw2-projects/` | □ | □ | □ | |
| PW-3 成员邀请 | `e2e/pw3-members/` | □ | □ | □ | |
| PW-4 Workspace | `e2e/pw4-workspaces/` | □ | □ | □ | |
| PW-5 运维页 | `e2e/pw5-ops/` | □ | □ | □ | |

**上线门禁（Playwright 部分）：** `@smoke` 全绿 + 全量 regression 在发版周全绿 + 无未关闭 P0/P1。

---

## 12. 附录 A · 路由与页面对照

| 路由 | 组件 | 子任务 |
|------|------|--------|
| `/login` | LoginPage | PW-1 |
| `/projects` | ProjectsPage | PW-2 |
| `/projects/:id` | ProjectDetailPage | PW-2 |
| `/projects/:id/members` | MembersPage | PW-3 |
| `/members` | MembersPage | PW-3 |
| `/invitations/accept` | AcceptInvitePage（需登录） | PW-3 |
| `/workspaces` | WorkspacesPage | PW-4 |
| `/nodes` | NodesPage | PW-5 |
| `/capacity` | CapacityPage | PW-5 |
| `/settings/keys` | SSHKeysPage | PW-5 |
| `/audit` | AuditPage（API 为 `/audit-logs`） | PW-5 |

## 附录 B · 本地快速排错

| 现象 | 检查 |
|------|------|
| API 起不来 / `go: command not found` | `PATH` 含 `$HOME/.local/go/bin`；config 已注入 |
| 创建 Workspace 报 incus 错误 | 未设 `HA_RUNTIME=memory`（本机有 `/usr/bin/incus`） |
| ECONNREFUSED 5173 | `npm run dev` 是否起；`reuseExistingServer` |
| 全部 401 | admin 密码是否被 `HA_ADMIN_PASSWORD` 改掉 |
| 随机 409 资源不足 | 有 `@capacity` 用例混进了 `chromium` project；或复用服务上残留占位机（重启 API） |
| 被踢回 `/login?reason=expired` | 多个测试共用了同一 refresh；确认走 `pageAs()` |
| `npm test` 报 e2e 文件错误 | `vite.config.ts` 未排除 `e2e/**` |
| heartbeat 400 | 请求体含 `models.Node` 之外的字段 |
| 下载用例失败 | 用 `download.path()` 读文件；`acceptDownloads` 默认 true |

## 附录 C · 未来扩展（非本期）

| 套件 | 环境 | 内容 |
|------|------|------|
| `e2e-staging` | T1 URL | 登录走 HTTPS、Postgres 持久 |
| `e2e-ssh` | T5 后 | 真 SSH config + `ssh -G` |
| `e2e-worker` | T4 后 | Q4-07 真 Incus 状态回显 |

本期 **不做** 上述套件，仅在计划中预留目录名，避免与本地 PW-1–5 混跑。
