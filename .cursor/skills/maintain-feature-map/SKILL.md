---
name: maintain-feature-map
description: >-
  Updates docs/agent/FEATURE_MAP.md when console routes, sidebars, Dialogs, or
  data-testid values change. Use when editing web/src/App.tsx, Layout, page
  entry points, primary actions, or Playwright specs, or when a Feature Map
  section no longer matches the UI.
---

# Maintain Feature Map

If you change a user-facing entry or a control an Agent must click, update [docs/agent/FEATURE_MAP.md](../../../docs/agent/FEATURE_MAP.md) in the same change.

## Diff checklist

- `web/src/App.tsx` routes added/removed/renamed
- `NAV_TESTIDS` / `resources.ts` sidebar labels
- `ProjectSubSidebar` / `WorkspaceSubSidebar` tabs
- New or renamed `data-testid` / `testId` on primary actions
- Role gates in `accessControl.ts`
- E2E specs under `web/e2e/` that encode a user path

## How to patch

1. Find the feature section (项目 / 服务器 / 成员 / 节点 …).
2. Update 怎么进入 + 选择器 together. Do not leave a testid in the map that no longer exists in code.
3. If you add a primary button/link/tab, give it a stable `data-testid` first (prefixes: `nav-*`, `login-*`, `project-*`, `ws-*`, `nodes-*`, `audit-*`).
4. Duplicate testids across desktop subnav and mobile tabs must stay scoped in the map.
5. Never add credentials to the map.

If the UI rewrite is large (many routes), switch to the `create-feature-map` skill and rebuild.
