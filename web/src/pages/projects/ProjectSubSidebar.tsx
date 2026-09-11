import { useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderKanban,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { copyText } from "./format";

interface ProjectSubSidebarProps {
  projectId: string;
  projectName?: string;
  projectSlug?: string;
  onNavigate?: () => void;
}

interface SubNavItemProps {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  index: number;
  registerItem: (index: number, element: HTMLElement | null) => void;
  isActive: boolean;
  testId: string;
  onNavigate?: () => void;
}

function SubNavItem({ to, label, icon: Icon, index, registerItem, isActive, testId, onNavigate }: SubNavItemProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);

  return (
    <NavLink
      ref={ref}
      to={to}
      data-testid={testId}
      onClick={onNavigate}
      className={cn(
        "relative z-10 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring select-none whitespace-nowrap",
        isActive
          ? "bg-primary/10 text-primary dark:bg-primary/15 font-semibold"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export function ProjectSubSidebar({
  projectId,
  projectName,
  projectSlug,
  onNavigate,
}: ProjectSubSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const navRef = useRef<HTMLElement>(null);
  const hover = useFluidHover(navRef, { axis: "y" });

  const pathname = location.pathname;
  const isOverview =
    pathname === `/projects/${projectId}` ||
    pathname === `/projects/${projectId}/overview` ||
    pathname === `/projects/${projectId}/`;
  const isWorkspaces = pathname.startsWith(`/projects/${projectId}/workspaces`);
  const isMembers = pathname.startsWith(`/projects/${projectId}/members`);
  const isSettings = pathname.startsWith(`/projects/${projectId}/settings`);

  const subItems = [
    {
      to: `/projects/${projectId}`,
      label: "项目概览",
      icon: LayoutDashboard,
      isActive: isOverview,
      testId: "project-tab-overview",
    },
    {
      to: `/projects/${projectId}/workspaces`,
      label: "工作区服务器",
      icon: Box,
      isActive: isWorkspaces,
      testId: "project-tab-workspaces",
    },
    {
      to: `/projects/${projectId}/members`,
      label: "成员与权限",
      icon: Users,
      isActive: isMembers,
      testId: "project-tab-members",
    },
    {
      to: `/projects/${projectId}/settings`,
      label: "设置与预算",
      icon: Settings,
      isActive: isSettings,
      testId: "project-tab-settings",
    },
  ];

  async function handleCopyId() {
    const ok = await copyText(projectId);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <motion.aside
      data-testid="project-subnav"
      animate={{ width: collapsed ? 44 : 210 }}
      transition={spring.moderate}
      className="relative flex h-full shrink-0 flex-col border-r border-border/80 bg-surface-1/60 select-none backdrop-blur-sm overflow-hidden"
    >
      {/* 顶部标题区 */}
      <div className="flex flex-col gap-2 p-3 border-b border-border/60">
        {!collapsed ? (
          <>
            <div className="flex items-center justify-between gap-1">
              <Button
                type="button"
                variant="ghost"
                size="compact"
                data-testid="project-back-list"
                onClick={() => {
                  onNavigate?.();
                  navigate("/projects");
                }}
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1 -ml-1 shrink-0 font-normal"
              >
                <ArrowLeft className="size-3.5 shrink-0" />
                <span className="whitespace-nowrap">全部项目</span>
              </Button>
              <Hint label={collapsed ? "展开二级菜单" : "收起二级菜单"} side="right">
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={() => setCollapsed(!collapsed)}
                  className="size-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
              </Hint>
            </div>

            <div className="flex items-center gap-2 min-w-0 pt-0.5">
              <span className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                <FolderKanban className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="m-0 text-sm font-semibold tracking-tight text-foreground truncate" title={projectName || "项目详情"}>
                  {projectName || "项目详情"}
                </h3>
                {projectSlug && (
                  <p className="m-0 text-[11px] font-mono text-muted-foreground truncate">
                    {projectSlug}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-1 pt-1">
              <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[125px]" title={projectId}>
                {projectId.slice(0, 14)}…
              </span>
              <Hint label={copied ? "已复制 ID" : "复制项目 ID"}>
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={handleCopyId}
                  className={cn(
                    "size-5 p-0 shrink-0 text-muted-foreground hover:text-foreground transition-colors",
                    copied && "text-emerald-500 bg-emerald-500/10",
                  )}
                  aria-label="复制项目 ID"
                >
                  {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3 opacity-60" />}
                </Button>
              </Hint>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Hint label="展开二级菜单" side="right">
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => setCollapsed(false)}
                className="size-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
              >
                <ChevronRight className="size-4" />
              </Button>
            </Hint>
            <Hint label={projectName || "项目详情"} side="right">
              <span className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                <FolderKanban className="size-3.5" />
              </span>
            </Hint>
          </div>
        )}
      </div>

      {/* 二级菜单项列表 */}
      <ScrollArea className="flex-1 w-full min-h-0" viewportClassName="p-2">
        <nav ref={navRef} className="relative flex flex-col gap-1 w-full" {...hover.handlers}>
          {!collapsed && <FluidHoverHighlight hover={hover} className="rounded-lg bg-hover" />}
          {subItems.map((item, index) => {
            if (collapsed) {
              return (
                <Hint key={item.to} label={item.label} side="right">
                  <NavLink
                    to={item.to}
                    data-testid={item.testId}
                    onClick={onNavigate}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring select-none mx-auto",
                      item.isActive
                        ? "bg-primary/10 text-primary dark:bg-primary/15 font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                  </NavLink>
                </Hint>
              );
            }
            return (
              <SubNavItem
                key={item.to}
                to={item.to}
                label={item.label}
                icon={item.icon}
                index={index}
                registerItem={hover.registerItem}
                isActive={item.isActive}
                testId={item.testId}
                onNavigate={onNavigate}
              />
            );
          })}
        </nav>
      </ScrollArea>
    </motion.aside>
  );
}
