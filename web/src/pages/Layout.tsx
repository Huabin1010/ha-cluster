import { PropsWithChildren, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useGetIdentity, useList, useLogout, useMenu } from "@refinedev/core";
import { useIsFetching } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
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
  Container,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { writeCurrentProject } from "@/lib/current-project";
import { canApproveDangerousOps, canManageNodes, canViewAudit, isPlatformAdmin } from "@/lib/permissions";
import { Combobox } from "@/components/ui/combobox";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { ProjectSubSidebar } from "@/pages/projects/ProjectSubSidebar";
import { WorkspaceSubSidebar } from "@/pages/workspaces/WorkspaceSubSidebar";
import { HaBrand, HaLogo } from "@/components/brand/HaLogo";

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
  "dangerous-approvals": ScrollText,
  "docker-registries": Container,
};

const NAV_TESTIDS: Record<string, string> = {
  projects: "nav-projects",
  memberships: "nav-members",
  workspaces: "nav-workspaces",
  nodes: "nav-nodes",
  capacity: "nav-capacity",
  "ssh-keys": "nav-keys",
  "audit-logs": "nav-audit",
  "dangerous-approvals": "nav-dangerous",
  "docker-registries": "nav-docker-registries",
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

interface NavItemProps {
  item: {
    key?: string;
    name: string;
    route?: string;
    label?: ReactNode;
    meta?: Record<string, unknown>;
  };
  index: number;
  registerItem: (index: number, element: HTMLElement | null) => void;
  rail: boolean;
  onNavigate?: () => void;
}

function NavItem({ item, index, registerItem, rail, onNavigate }: NavItemProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);

  const Icon = NAV_ICONS[item.name] ?? Box;
  const testId = (item.meta as { testId?: string } | undefined)?.testId ?? NAV_TESTIDS[item.name];
  const label = String(item.label ?? "");

  const navLink = (
    <NavLink
      ref={ref}
      data-testid={testId}
      to={item.route || "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "relative z-10 flex items-center rounded-lg text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring select-none",
          rail
            ? "size-9 justify-center p-0"
            : "w-full gap-2.5 px-3 py-2",
          isActive
            ? "bg-primary/10 text-primary dark:bg-primary/15 font-semibold"
            : "text-muted-foreground hover:text-foreground",
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={cn(rail ? "sr-only" : "truncate")}>{label}</span>
    </NavLink>
  );

  if (rail) {
    return (
      <Hint label={label} side="right">
        {navLink}
      </Hint>
    );
  }

  return navLink;
}

export function Layout({ children }: PropsWithChildren) {
  const { mutate } = useLogout();
  const { data: me } = useGetIdentity<{ username?: string; platform_role?: string }>();
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
  const showFetchHint = fetching > 0;
  const projects = projectData?.data ?? [];

  const projectMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const isInProjectContext = !!(
    projectMatch &&
    projectMatch[1] &&
    projectMatch[1] !== "undefined"
  );
  const activeProjectId = isInProjectContext ? projectMatch[1] : "";
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  );

  const workspaceMatch = location.pathname.match(/^\/workspaces\/([^/]+)/);
  const isInWorkspaceContext = !!(
    workspaceMatch &&
    workspaceMatch[1] &&
    workspaceMatch[1] !== "undefined"
  );
  const activeWorkspaceId = isInWorkspaceContext ? workspaceMatch[1] : "";

  const projectFromQuery = new URLSearchParams(location.search).get("project_id") || "";
  const currentProject = activeProjectId || projectFromQuery;

  // 进入项目或服务器详情时，主侧栏收成 Icon Rail，给二级菜单留出空间
  const effectiveRail = isMd && (collapsed || isInProjectContext || isInWorkspaceContext);
  const rail = effectiveRail;

  const navRef = useRef<HTMLElement>(null);
  const hover = useFluidHover(navRef, { axis: "y" });

  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (item.name === "nodes" || item.name === "capacity") return canManageNodes(me?.platform_role);
      if (item.name === "audit-logs") return canViewAudit(me?.platform_role);
      if (item.name === "dangerous-approvals") return canApproveDangerousOps(me?.platform_role);
      if (item.name === "docker-registries") return isPlatformAdmin(me?.platform_role);
      return true;
    });
  }, [menuItems, me?.platform_role]);

  useEffect(() => {
    hover.remeasure();
  }, [rail, filteredMenuItems.length]);

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
      <AnimatePresence>
        {navOpen && (
          <motion.button
            key="nav-backdrop"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={spring.fast}
            className="nav-backdrop fixed inset-0 z-30 h-auto w-auto rounded-none border-0 bg-black/45 hover:bg-black/45 md:hidden"
            aria-label="关闭菜单"
            onClick={() => setNavOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        id="app-sidebar"
        data-collapsed={rail ? "true" : undefined}
        animate={{
          width: isMd ? (rail ? 64 : 240) : undefined,
        }}
        transition={spring.moderate}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-svh w-[min(280px,86vw)] flex-col border-r border-border bg-surface-1 p-3 md:static md:translate-x-0 select-none",
          rail ? "gap-4 md:items-center md:px-0 md:py-3" : "gap-3 md:w-60",
        )}
      >
        <div className={cn("flex w-full items-center gap-2", rail ? "flex-col" : "justify-between px-1")}>
          {rail ? (
            <Hint label="ha-cluster" side="right">
              <span data-testid="brand-logo" className="inline-flex">
                <HaLogo size={28} className="text-foreground" />
              </span>
            </Hint>
          ) : (
            <HaBrand />
          )}
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="outline" className={cn("hidden uppercase text-[10px] tracking-wider py-0 px-1.5 font-mono", !rail && "md:inline-flex")} data-testid="env-badge">
              {ENV_LABEL}
            </Badge>
            <Hint label={collapsed ? "展开侧栏" : "收起侧栏"} side="right">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hidden h-7 w-7 p-0 md:inline-flex text-muted-foreground hover:text-foreground"
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
          <div className="px-1">
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
          </div>
        )}

        <ScrollArea
          className="flex-1 w-full min-h-0"
          viewportClassName={cn("px-1", rail && "flex flex-col items-center")}
        >
          <nav
            ref={navRef}
            className={cn(
              "relative flex min-h-0 w-full flex-col gap-1 py-1",
              rail ? "items-center" : "",
            )}
            {...hover.handlers}
          >
            <FluidHoverHighlight hover={hover} className="rounded-lg bg-hover" />
            {filteredMenuItems.map((item, index) => (
              <NavItem
                key={item.key}
                item={item}
                index={index}
                registerItem={hover.registerItem}
                rail={rail}
                onNavigate={() => setNavOpen(false)}
              />
            ))}
          </nav>
        </ScrollArea>

        <Separator className="w-full opacity-60" />

        <div className={cn("flex w-full items-center gap-2 px-1", rail ? "flex-col justify-center" : "justify-between")}>
          <div className={cn("flex items-center gap-2 min-w-0", rail && "hidden")}>
            <span className="size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
              {(me?.username?.[0] || "U").toUpperCase()}
            </span>
            <span className="truncate text-xs font-medium text-muted-foreground" data-testid="current-user">
              {me?.username || "—"}
            </span>
          </div>
          <div className={cn("flex items-center", rail ? "flex-col gap-2" : "gap-1")}>
            <Hint label={rail ? "切换主题" : undefined} side="right">
              <span className="inline-flex size-7 items-center justify-center">
                <ThemeToggle />
              </span>
            </Hint>
            <Hint label={rail ? "退出" : undefined} side="right">
              <Button
                data-testid="logout-button"
                type="button"
                variant="ghost"
                size={rail ? "icon" : "sm"}
                className={rail ? "h-7 w-7 p-0 text-muted-foreground hover:text-foreground" : "h-7 px-2 text-xs text-muted-foreground hover:text-foreground"}
                aria-label="退出"
                onClick={() => mutate()}
              >
                {rail ? <LogOut className="size-3.5" /> : "退出"}
              </Button>
            </Hint>
          </div>
        </div>
      </motion.aside>

      {/* 桌面端项目二级菜单栏 */}
      {isMd && isInProjectContext && (
        <ProjectSubSidebar
          key={activeProjectId}
          projectId={activeProjectId}
          projectName={activeProject?.name}
          projectSlug={activeProject?.slug}
        />
      )}
      {isMd && isInWorkspaceContext && (
        <WorkspaceSubSidebar key={activeWorkspaceId} workspaceId={activeWorkspaceId} />
      )}

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
          <HaBrand className="flex-1" />
          <ThemeToggle />
          <Hint label="运行环境">
            <span className="inline-flex">
              <Badge variant="outline" className="uppercase" data-testid="env-badge">
                {ENV_LABEL}
              </Badge>
            </span>
          </Hint>
        </header>

        <main className="main-pane relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-4 md:p-6">
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
