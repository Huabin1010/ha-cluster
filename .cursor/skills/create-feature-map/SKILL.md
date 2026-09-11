---
name: create-feature-map
description: >-
  Explores ha-cluster console routes, sidebars, data-testid attributes, and
  Playwright e2e specs, then writes or rebuilds docs/agent/FEATURE_MAP.md from
  the user perspective. Use when creating the Feature Map, regenerating it
  after a large UI rewrite, or when the map is missing or clearly stale.
---

# Create Feature Map

Rebuild [docs/agent/FEATURE_MAP.md](../../../docs/agent/FEATURE_MAP.md). Do not invent screens.

## Sources (read these)

1. Routes: `web/src/App.tsx`
2. Sidebar: `web/src/refine/resources.ts`, `web/src/pages/Layout.tsx` (`NAV_TESTIDS`)
3. Nested nav: `web/src/pages/projects/ProjectSubSidebar.tsx`, `web/src/pages/workspaces/WorkspaceSubSidebar.tsx`
4. Pages under `web/src/pages/` — collect `data-testid` / `testId`
5. Role gates: `web/src/refine/accessControl.ts`, `web/src/lib/permissions.ts`
6. E2E: `web/e2e/**/*.spec.ts` and `web/e2e/helpers/dialog.ts`

## Output rules

Each feature uses four blocks:

- **怎么进入** — sidebar testid, URL, nested tab
- **子功能** — list, create Dialog, row actions, empty/error
- **快捷键** — write 「无」 if none
- **选择器** — `data-testid` plus role gates

User words first: 「机器 / 服务器」= Workspace. Never put passwords in the map (point to `docs/credentials.local.md` and `web/e2e/fixtures/auth.ts`).

If a testid appears in both desktop subnav and mobile tabs, document a **scoped** selector (`project-subnav` vs `project-mobile-tabs`). Prefer existing prefixes: `nav-*`, `login-*`, `project-*`, `ws-*`, `nodes-*`, `audit-*`.

After writing, skim every `App.tsx` route: each must appear in the map.
