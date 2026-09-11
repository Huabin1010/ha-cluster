---
name: verify-console
description: >-
  Drives the ha-cluster web console like a user: read the Feature Map, start
  the local app, click data-testid selectors in the browser, and re-check the
  same path after a change. Use when verifying UI, reproducing a screenshot or
  bug report, or operating projects/workspaces/nodes in the console. Do not
  guess the UI from source alone.
---

# Verify Console

Agent 验收 = **像用户一样点控制台**，不是读组件猜。

## Loop

1. Read [docs/agent/FEATURE_MAP.md](../../../docs/agent/FEATURE_MAP.md). Locate the feature from the user’s words or screenshot (「左侧边栏」「开通服务器」「节点加入命令」).
2. Start the app if needed:
   - `bun run dev` or `bun scripts/dev.ts` (API + Vite)
   - Console: `http://127.0.0.1:5173`
   - Credentials: `docs/credentials.local.md` or `web/e2e/fixtures/auth.ts`. Never log passwords in chat.
3. In the browser, click **testid** from the map. Prefer scoped selectors when duplicates exist (`project-subnav` vs `project-mobile-tabs`).
4. Observe the real screen (status, toast, Dialog, empty/error). Only then open source if the UI is wrong.
5. After a code change, walk the **same path** again. Appearance-only screenshots are not verification.

## Clicking rules

- Dialogs: same semantics as `web/e2e/helpers/dialog.ts` — `openCreateDialog`, `chooseSelect` (`[role=option][data-value=…]`), `confirmAlert` (`confirm-ok` / `confirm-cancel`). No native `select` / `window.confirm`.
- Hidden platform items (`nav-nodes`, `nav-audit`, `nav-dangerous`, `nav-docker-registries`) follow the map’s 角色门. Do not assume every role sees every item.
- Dangerous ops (销毁终审 `dangerous-confirm`, 删除项目/成员) still go through the confirm UI. Do not bypass approval APIs to “make the demo pass”.
- Web terminal is WebSocket (`ws-web-terminal`); do not treat it as a REST tool.

## When the map is wrong

Stop clicking randomly. Update the map with `maintain-feature-map` (or rebuild with `create-feature-map`), then re-verify.
