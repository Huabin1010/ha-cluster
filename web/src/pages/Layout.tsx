import { PropsWithChildren, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useGetIdentity, useList, useLogout, useMenu } from "@refinedev/core";
import { useIsFetching } from "@tanstack/react-query";
import {
  Box,
  FolderKanban,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Server,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { Badge } from "../components/ui/badge";
import { Spinner } from "../components/ui/spinner";
import { Hint } from "../components/ui/tooltip";
import { ThemeToggle } from "../components/theme-toggle";
import { cn } from "../lib/utils";
import { writeCurrentProject } from "../lib/current-project";
import { Combobox } from "../components/ui/combobox";

const ENV_LABEL = import.meta.env.PROD ? "prod" : "dev";
const SIDEBAR_COLLAPSED_KEY = "ha_sidebar_collapsed";

const NAV_ICONS: Record<string, LucideIcon> = {
  projects: FolderKanban,
  memberships: Users,
  workspaces: Box,
  nodes: Server,
  capacity: Gauge,
  "ssh-keys": KeyRound,
  "audit-logs": ScrollText,
};

const NAV_TESTIDS: Record<string, string> = {
  projects: "nav-projects",
  memberships: "nav-members",
  workspaces: "nav-workspaces",
  nodes: "nav-nodes",
  capacity: "nav-capacity",
  "ssh-keys": "nav-keys",
  "audit-logs": "nav-audit",
};

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function useIsMd() {
  const [isMd, setIsMd] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsMd(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMd;
}

export function Layout({ children }: PropsWithChildren) {
  const { mutate } = useLogout();
  const { data: me } = useGetIdentity<{ username?: string }>();
  const { menuItems } = useMenu();
  const { data: projectData } = useList<{ id: string; name: string; slug: string }>({
    resource: "projects",
    pagination: { mode: "off" },
  });
  const navigate = useNavigate();
  const location = useLocation();
  const fetching = useIsFetching();
  const isMd = useIsMd();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const rail = collapsed && isMd;
  const showFetchHint = fetching > 0;
  const projects = projectData?.data ?? [];
  const projectFromPath = location.pathname.match(/^\/projects\/([^/]+)/)?.[1] || "";
  const projectFromQuery = new URLSearchParams(location.search).get("project_id") || "";
  const currentProject = projectFromPath && projectFromPath !== "undefined" ? projectFromPath : projectFromQuery;

  function onSwitchProject(id: string) {
    writeCurrentProject(id);
    if (location.pathname.startsWith("/workspaces")) {
      navigate(`/workspaces?project_id=${encodeURIComponent(id)}`);
      return;
    }
    if (location.pathname.includes("/members")) {
      navigate(`/projects/${id}/members`);
      return;
    }
    navigate(`/projects/${id}`);
  }

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* private mode / quota */
      }
      return next;
    });
  };

  return (
    <div className={cn("shell flex h-svh overflow-hidden", navOpen && "nav-open")}>
        {navOpen && (
          <Button
            type="button"
            variant="ghost"
            className="nav-backdrop fixed inset-0 z-30 h-auto w-auto rounded-none bg-black/45 hover:bg-black/45 md:hidden"
            aria-label="关闭菜单"
            onClick={() => setNavOpen(false)}
          />
        )}

        <aside
          id="app-sidebar"
          data-collapsed={rail ? "true" : undefined}
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex h-svh w-[min(280px,86vw)] flex-col border-r border-border bg-card p-4 transition-[width] duration-200 md:static md:translate-x-0",
            rail ? "gap-4 md:w-16 md:items-center md:px-0 md:py-3" : "gap-3 md:w-60",
          )}
        >
          <div className={cn("flex w-full items-center gap-2", rail ? "justify-center" : "justify-between")}>
            <div className={cn("min-w-0 font-bold tracking-wide", rail && "hidden")}>ha-cluster</div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant="outline" className={cn("hidden uppercase", !rail && "md:inline-flex")} data-testid="env-badge">
                {ENV_LABEL}
              </Badge>
              <Hint label={collapsed ? "展开侧栏" : "收起侧栏"} side="right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden h-8 w-8 p-0 md:inline-flex"
                  data-testid="sidebar-collapse"
                  aria-expanded={!collapsed}
                  aria-controls="app-sidebar"
                  aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
                  onClick={toggleCollapsed}
                >
                  {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </Button>
              </Hint>
            </div>
          </div>
          {!rail && projects.length > 0 && (
            <Combobox
              testId="nav-project-switch"
              value={currentProject}
              onValueChange={onSwitchProject}
              placeholder="选择项目…"
              searchPlaceholder="按名称过滤…"
              emptyText="无匹配项目"
              aria-label="当前项目"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
          <nav
            className={cn(
              "flex min-h-0 w-full flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              rail ? "items-center gap-2.5" : "gap-1.5",
            )}
            onClick={() => setNavOpen(false)}
          >
            {menuItems.map((item) => {
              const Icon = NAV_ICONS[item.name] ?? Box;
              const testId = (item.meta as { testId?: string } | undefined)?.testId ?? NAV_TESTIDS[item.name];
              const label = String(item.label ?? "");
              return (
                <Hint key={item.key} label={rail ? label : undefined} side="right">
                  <NavLink
                    data-testid={testId}
                    to={item.route || "/"}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                        rail
                          ? "size-9 justify-center p-0"
                          : "w-full gap-2 px-2 py-2",
                        isActive && "bg-primary/15 font-medium text-primary",
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className={cn(rail ? "sr-only" : "truncate")}>{label}</span>
                  </NavLink>
                </Hint>
              );
            })}
          </nav>
          <Separator className="w-full" />
          <div className={cn("flex w-full items-center gap-2", rail ? "flex-col justify-center" : "justify-between")}>
            <span className={cn("truncate text-sm text-muted-foreground", rail && "hidden")} data-testid="current-user">
              {me?.username || "—"}
            </span>
            <div className={cn("flex items-center", rail ? "flex-col gap-2" : "gap-1")}>
              <Hint label={rail ? "切换主题" : undefined} side="right">
                <span className="inline-flex size-8 items-center justify-center">
                  <ThemeToggle />
                </span>
              </Hint>
              <Hint label={rail ? "退出" : undefined} side="right">
                <Button
                  data-testid="logout-button"
                  type="button"
                  variant="ghost"
                  size={rail ? "icon" : "sm"}
                  className={rail ? "h-8 w-8 p-0" : undefined}
                  aria-label="退出"
                  onClick={() => mutate()}
                >
                  {rail ? <LogOut className="size-4" /> : "退出"}
                </Button>
              </Hint>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="topbar flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2 md:hidden">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="nav-toggle"
              aria-expanded={navOpen}
              aria-controls="app-sidebar"
              onClick={() => setNavOpen((v) => !v)}
            >
              <Menu className="h-4 w-4" />
              菜单
            </Button>
            <span className="flex-1 font-semibold">ha-cluster</span>
            <ThemeToggle />
            <Hint label="运行环境">
              <span className="inline-flex">
                <Badge variant="outline" className="uppercase" data-testid="env-badge">
                  {ENV_LABEL}
                </Badge>
              </span>
            </Hint>
          </header>

          <main className="main-pane relative flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
            {showFetchHint && (
              <div className="fetch-hint mb-2 flex shrink-0 justify-end" aria-live="polite">
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner />
                  加载中…
                </span>
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
  );
}
