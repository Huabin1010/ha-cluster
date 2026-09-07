# 16 · 前端全量代码审查报告 (Frontend Code Review)

> 上级：[00-index.md](00-index.md)  
> 任务分工：[14-ui-and-qa-tasks.md](14-ui-and-qa-tasks.md)  
> E2E 体系：[15-playwright-test-plan.md](15-playwright-test-plan.md)  
> 审查日期：2026-09-07  
> 审查范围：`web/` 目录全量代码（37 个源码文件、5 个单测套件、Playwright E2E 测试集）

---

## 1. 概览与架构评估

### 1.1 前端技术栈与代码规模
- **核心框架**：React 18.3 + TypeScript 5.8 + Vite 6.3
- **平台与状态库**：Refine Core 4.57 + TanStack React Query 5.102 + React Router v6.30
- **样式方案**：纯原生 CSS（`web/src/styles.css`，无 Tailwind/CSS-in-JS 冗余依赖，轻量快速）
- **测试框架**：Vitest 3.1（单元测试 5 个文件、30 个用例全绿）+ Playwright 1.63（本地内存集成 E2E 83 个用例）

### 1.2 架构健康度评分与主要优点
- **分层清晰**：`providers.ts`（网络通信与鉴权）、`ui/*`（基础通用组件）、`pages/*`（按业务域划分）职责边界清晰。
- **硬占用与超卖交互打磨**：针对 409 `INSUFFICIENT_CAPACITY` 的全局与局部拦截处理到位，用户提示友好。
- **认证保壳机制**：在网络断开或服务端临时 5xx 时保持会话外壳，仅在明确 401 且 refresh 失败后才跳转登录，避免用户误登出。
- **响应式完备**：移动端抽屉与桌面端双层自适应，且由 Playwright 针对 Pixel 5 做了针对性端到端回归。

---

## 2. 问题清单与严重等级评估

| 级别 | 问题项 | 涉及文件 | 影响 |
|------|--------|----------|------|
| **P1** | 本地开发反代端口与后端默认端口不一致 | `web/vite.config.ts` | 直接独立运行前端 dev 时无法命中默认的 8080 后端端口 |
| **P1** | 用户身份 `getIdentity` 本地持久化缓存无过期/失效机制 | `web/src/providers.ts` | 角色被提权或降权后，前端永久读取旧角色直至主动退出 |
| **P1** | 打包产物单 bundle 超过 518kB 触发警告 | `web/src/App.tsx`, `web/vite.config.ts` | 首屏加载体积偏大，缺少路由懒加载与 vendor 分包 |
| **P1** | 原生 `window.confirm` 阻塞线程与体验割裂 | `WorkspaceRow.tsx`, `MemberList.tsx`, `SSHKeys.tsx` | 阻断式弹窗无法统一视觉规范，对自动化测试友好度低 |
| **P2** | Refine 规范与原生 `api()` 状态同步机制割裂 | `Workspaces.tsx`, `CreateForm.tsx` | 依赖 `usageTick` 手动自增刷新，未利用 React Query 缓存失效 |
| **P2** | 资源单位与时间格式化工具函数跨模块冗余实现 | `projects/format.ts`, `ops/format.ts` | 两份 `formatBytes`/`fmtBytes` 实现逻辑与命名不一致 |
| **P2** | 侧边栏未按权限隐藏受保护入口 | `web/src/pages/Layout.tsx`, `Audit.tsx` | 非管理员用户点击「审计」后直接报 403 红色错误 |
| **P2** | 预算输入直接填写原始字节数字符串 | `web/src/pages/projects/Detail.tsx` | 用户需要手动计算类似 10737418240 的数字，极易输错 |
| **P2** | 成员管理列表缺乏用户名展示仅显示 UUID | `web/src/pages/members/MemberList.tsx` | 无法直观识别项目成员的具体账号是谁 |
| **P2** | 系统缺少项目所有权 (Owner) 转让入口 | `web/src/pages/members/roles.ts` | 用户创建项目后无法将 owner 转移给其他管理员 |
| **P3** | 抽屉导航缺少键盘 `Escape` 关闭事件 | `web/src/pages/Layout.tsx` | 键盘操作/无障碍体验存在闭环盲区 |
| **P3** | SSH Config 下载时 `URL.revokeObjectURL` 立即释放 | `web/src/pages/workspaces/WorkspaceRow.tsx` | 极小概率在慢速环境下导致下载文件创建失败 |
| **P3** | `tsconfig.json` 未开启未用变量与参数检查 | `web/tsconfig.json` | 无法在编译期防范废弃变量残留 |

---

## 3. 核心问题深度分析与改进方案

### 3.1 [P1] 本地开发反代端口对齐
- **现状**：
  `web/vite.config.ts`:
  ```ts
  target: process.env.VITE_API_TARGET || "http://127.0.0.1:8088"
  ```
  `cmd/ha-api/main.go`:
  ```go
  addr := env("HA_API_ADDR", ":8080")
  ```
- **分析**：Playwright E2E 将端口指定为 8088，但普通开发者本地运行 `go run ./cmd/ha-api` 时默认监听 8080。若未配置环境变量直接 `npm run dev`，所有 `/api` 请求均会因连不上 8088 而报代理错误。
- **建议方案**：将 `vite.config.ts` 的默认回退地址改为 `http://127.0.0.1:8080`，在 Playwright 配置文件中通过环境变量显式传递 `VITE_API_TARGET=http://127.0.0.1:8088`。

---

### 3.2 [P1] 身份缓存与动态刷新
- **现状**：
  `web/src/providers.ts`:
  ```ts
  getIdentity: async (): Promise<AuthUser | null> => {
    const raw = localStorage.getItem("ha_user");
    if (raw) {
      try {
        const cached = JSON.parse(raw) as AuthUser;
        if (cached.platform_role) return cached;
      } catch {}
    }
    // ...
  }
  ```
- **分析**：一旦用户登录并在 localStorage 中写入了 `cached.platform_role`，`getIdentity` 永远直接返回缓存对象，不再向后端重新确认 `/me`。如果平台管理员对该账号进行了权限变更（如取消 platform_admin），前端页面不会感知，仍然展示对账等管理功能，直到调用接口被 403 拦截。
- **建议方案**：配合 TanStack Query 的 `staleTime`（例如设置为 5 分钟），或者在页面首次载入或路由切换时通过后台异步静默校验 `/me`，若角色变更则更新缓存并触发 re-render。

---

### 3.3 [P1] 单 Bundle 体积优化（路由分包）
- **现状**：
  `web/src/App.tsx` 一次性同步静态引入所有 9 个页面组件，打包生成一个 518kB 的单体 JS 文件。
- **建议方案**：
  1. 使用 `React.lazy` 懒加载低频与管理页面（`CapacityPage`, `SSHKeysPage`, `AuditPage`, `AcceptInvitePage`）。
  2. 在 `web/vite.config.ts` 中配置 Rollup 分块：
  ```ts
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          refine: ["@refinedev/core", "@refinedev/react-router-v6", "@tanstack/react-query"],
        },
      },
    },
  }
  ```

---

### 3.4 [P2] 状态管理模式统一（替换 `usageTick`）
- **现状**：
  `WorkspacesPage` 与 `CreateForm` 采用以下传参机制：
  ```tsx
  <CreateForm
    projects={projects}
    initialProjectId={projectFilter}
    usageTick={usageTick}
    onCreated={() => {
      showError("");
      toast.show("创建成功", "success");
      afterMutation(); // setUsageTick((n) => n + 1)
    }}
  />
  ```
- **分析**：这是用计数器模拟事件总线的反模式，打破了 React 数据流的可预测性。
- **建议方案**：接入 TanStack Query 的 QueryClient：
  ```ts
  const queryClient = useQueryClient();
  // 变更后
  queryClient.invalidateQueries({ queryKey: ["project-usage", projectId] });
  queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  ```
  统一使用 React Query 的声明式数据获取与自动失效刷新，移除多余的 useState 与局部 `cancelled` 旗标。

---

### 3.5 [P2] 消除格式化工具重复代码
- **现状**：
  - `web/src/pages/projects/format.ts`: `formatBytes`, `formatCpuMilli`, `formatBudget`, `formatTime`, `copyText`
  - `web/src/pages/ops/format.ts`: `fmtBytes`, `fmtCPU`, `fmtTime`
- **建议方案**：
  将通用的格式化函数统一收敛到 `web/src/ui/format.ts` 或 `web/src/utils/format.ts`，导出标准命名的 `formatBytes`、`formatCpu`、`formatTime` 与 `copyToClipboard`，让 `projects` 与 `ops` 统一引用同一套工具函数。

---

### 3.6 [P2] 侧边栏基于角色权限动态渲染
- **现状**：
  `web/src/pages/Layout.tsx` 总是无差别渲染 `<NavLink to="/audit">审计</NavLink>`。
- **建议方案**：
  从 `useGetIdentity` 中获取 `me?.platform_role`：
  ```tsx
  const isPlatformStaff = me?.platform_role === "platform_admin" || me?.platform_role === "platform_ops";
  // 仅平台工作人员展示审计
  {isPlatformStaff && <NavLink data-testid="nav-audit" to="/audit">审计</NavLink>}
  ```
  既提升安全规范，也避免普通开发者进入后被 403 困扰。

---

### 3.7 [P2] 人类可读单位与体验增强
- **预算配置优化**：
  在 `web/src/pages/projects/Detail.tsx` 中，为 `budget_mem_bytes` 与 `budget_disk_bytes` 提供单位选择框（MiB / GiB），输入数字后由前端自动换算为字节；输入框旁展示实时格式化预览（例如输入 1073741824 时显示 `1 GiB`）。
- **套餐规格明细呈现**：
  在 `CreateForm.tsx` 的套餐下拉选单中增加辅助说明文本（如 `nano (0.5 核, 512 MiB, 5 GiB)`），使用户在选择时直观了解配额消耗。

---

## 4. 实施路线与重构建议

### 第一阶段（高优先级修复）
1. 修改 `web/vite.config.ts` 反代默认端口为 `8080`，保障开发环境开箱即用。
2. 在 `web/src/App.tsx` 与 `vite.config.ts` 中完成动态路由懒加载与 vendor 分包，消除 500kB 构建体积警告。
3. 统一合并 `projects/format.ts` 与 `ops/format.ts` 为共享工具模块，修复单元测试引用。

### 第二阶段（状态与体验演进）
1. 在 `Layout.tsx` 中增加权限过滤，对非管理员隐藏 `/audit` 导航链接。
2. 封装统一的 `ConfirmModal` 或两步确认交互，替换 `window.confirm`。
3. 项目详情页预算表单加入单位换算器（MiB/GiB、核/mCPU）。

### 第三阶段（自动化与健壮性保障）
1. 在 `web/tsconfig.json` 中将 `noUnusedLocals` 和 `noUnusedParameters` 置为 `true`。
2. 增加对 `CreateForm` 和 `Toast` 组件的轻量级 `@testing-library/react` 单元测试。
