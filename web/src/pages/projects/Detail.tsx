import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useDelete, useGetIdentity, useList, useOne, useUpdate } from "@refinedev/core";
import {
  Activity,
  ArrowLeft,
  Box,
  Check,
  Clock,
  Copy,
  Cpu,
  Database,
  Edit3,
  ExternalLink,
  FolderKanban,
  HardDrive,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";
import { api, friendlyError, type AuthUser } from "@/providers";
import { copyText, formatBudget, formatBytes, formatCpuMilli, formatTime } from "./format";
import { canManageProject, type Project, type ProjectUsage } from "./types";
import { ProjectFormDialog } from "./FormDialog";
import { ProjectDeleteDialog } from "./DeleteDialog";
import { MemberList } from "@/pages/members/MemberList";
import { WorkspaceRow } from "@/pages/workspaces/WorkspaceRow";
import { CreateForm } from "@/pages/workspaces/CreateForm";
import {
  canApproveRole,
  statusLabel,
  workspaceStatusVariant,
  workspaceStatusDotClass,
  WORKSPACE_POLL_AFTER_MUTATION_MS,
  WORKSPACE_POLL_INTERVAL_MS,
  workspaceListQueryPollInterval,
  type Workspace,
  type ProjectOption,
} from "@/pages/workspaces/types";
import { readCurrentProject, writeCurrentProject } from "@/lib/current-project";
import { Paginator } from "@/components/ui/pagination";
import { useClientPager } from "@/lib/use-client-pager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Elevated } from "@/lib/elevated";
import { Empty, Loading } from "@/ui";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";

function parseBudgetInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

function calculatePercentage(used?: number, budget?: number): number | null {
  if (!budget || budget <= 0 || used == null) return null;
  const pct = Math.round((used / budget) * 100);
  return Math.min(Math.max(pct, 0), 100);
}

function getProgressColor(pct: number | null): string {
  if (pct === null) return "bg-primary";
  if (pct >= 90) return "bg-rose-500";
  if (pct >= 75) return "bg-amber-500";
  return "bg-primary";
}

interface NavTabItemProps {
  label: string;
  icon: typeof LayoutDashboard;
  isActive: boolean;
  onClick: () => void;
  index: number;
  testId: string;
  registerItem: (index: number, element: HTMLElement | null) => void;
}

function NavTabItem({ label, icon: Icon, isActive, onClick, index, testId, registerItem }: NavTabItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);

  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "relative z-10 flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring whitespace-nowrap cursor-pointer select-none",
        isActive
          ? "bg-surface-2 text-foreground font-semibold shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
      <span>{label}</span>
    </button>
  );
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: me } = useGetIdentity<AuthUser>();

  const { data, isLoading, isError, error, refetch } = useOne<Project>({
    resource: "projects",
    id,
  });

  const { mutate: patch, isLoading: savingBudget } = useUpdate();
  const { mutate: patchMeta, isLoading: savingMeta } = useUpdate();
  const { mutate: remove, isLoading: removing } = useDelete();
  const wsPollUntilRef = useRef(0);

  // 当前项目下的工作区列表
  const {
    data: wsData,
    isLoading: loadingWs,
    refetch: refetchWs,
  } = useList<Workspace>({
    resource: "workspaces",
    pagination: { mode: "off" },
    filters: id ? [{ field: "project_id", operator: "eq", value: id }] : [],
    errorNotification: false,
    queryOptions: {
      refetchInterval: (data) => {
        if (Date.now() < wsPollUntilRef.current) return WORKSPACE_POLL_INTERVAL_MS;
        return workspaceListQueryPollInterval(data);
      },
    },
  });

  const [usage, setUsage] = useState<ProjectUsage | null>(null);
  const [usageErr, setUsageErr] = useState("");
  const [budgetCpu, setBudgetCpu] = useState("");
  const [budgetMem, setBudgetMem] = useState("");
  const [budgetDisk, setBudgetDisk] = useState("");
  const [formErr, setFormErr] = useState("");
  const [formOk, setFormOk] = useState("");
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busyWsId, setBusyWsId] = useState<string | null>(null);
  const [wsToast, setWsToast] = useState<string | null>(null);
  const [wsErr, setWsErr] = useState("");

  const project = data?.data;
  const workspaces = (wsData?.data ?? []).filter((w) => w.status !== "destroyed");
  const runningWsCount = workspaces.filter((w) => w.status === "running").length;

  const tabsRef = useRef<HTMLDivElement>(null);
  const tabsHover = useFluidHover(tabsRef, { axis: "x" });

  // 判定当前活动的二级视图
  const pathname = location.pathname;
  const activeSection = useMemo(() => {
    if (pathname.includes("/workspaces")) return "workspaces";
    if (pathname.includes("/members")) return "members";
    if (pathname.includes("/settings")) return "settings";
    return "overview";
  }, [pathname]);

  useEffect(() => {
    if (project?.id) writeCurrentProject(project.id);
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    setBudgetCpu(String(project.budget_cpu_milli ?? 0));
    setBudgetMem(String(project.budget_mem_bytes ?? 0));
    setBudgetDisk(String(project.budget_disk_bytes ?? 0));
  }, [project]);

  const loadUsage = useCallback(async () => {
    if (!id) return;
    setUsageErr("");
    try {
      const u = await api<ProjectUsage>(`/projects/${id}/usage`);
      setUsage(u);
    } catch (e) {
      setUsageErr(friendlyError(e));
    }
  }, [id]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  async function onCopyId() {
    if (!project) return;
    const ok = await copyText(project.id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function onSaveMeta(name: string, slug: string) {
    setEditErr("");
    patchMeta(
      {
        resource: "projects",
        id,
        values: { name, slug },
        successNotification: { message: "项目已保存", type: "success" },
        errorNotification: false,
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          void refetch();
        },
        onError: (err) => {
          const raw = err instanceof Error ? err.message : String(err);
          if (raw === "conflict" || raw.includes("conflict")) {
            setEditErr("slug 已被占用，请换一个");
            return;
          }
          setEditErr(friendlyError(err));
        },
      },
    );
  }

  function confirmDelete() {
    setDeleteOpen(false);
    setFormErr("");
    remove(
      {
        resource: "projects",
        id,
        successNotification: { message: "项目已删除", type: "success" },
        errorNotification: false,
      },
      {
        onSuccess: () => {
          if (readCurrentProject() === id) writeCurrentProject("");
          navigate("/projects");
        },
        onError: (err) => setFormErr(friendlyError(err)),
      },
    );
  }

  function onSaveBudget(e: FormEvent) {
    e.preventDefault();
    setFormErr("");
    setFormOk("");
    const cpu = parseBudgetInput(budgetCpu);
    const mem = parseBudgetInput(budgetMem);
    const disk = parseBudgetInput(budgetDisk);
    if (cpu == null || mem == null || disk == null) {
      setFormErr("预算须为非负整数；填 0 表示不限制");
      return;
    }
    patch(
      {
        resource: "projects",
        id,
        values: {
          budget_cpu_milli: cpu,
          budget_mem_bytes: mem,
          budget_disk_bytes: disk,
        },
      },
      {
        onSuccess: () => {
          setFormOk("预算已成功保存");
          void refetch();
          void loadUsage();
        },
        onError: (err) => setFormErr(friendlyError(err)),
      },
    );
  }

  const isOwnerOrAdmin = project
    ? canManageProject(project.my_role, me?.platform_role, project.owner_id, me?.id)
    : false;

  const projectOptions: ProjectOption[] = useMemo(
    () => (project ? [{ id: project.id, name: project.name, slug: project.slug, my_role: project.my_role }] : []),
    [project],
  );

  const wsPager = useClientPager(workspaces, `ws-${id}`, 10);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loading label="加载项目…" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="grid max-w-lg gap-4 p-4">
        <Alert variant="destructive">
          <AlertDescription>{friendlyError(error) || "项目不存在或无权访问"}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" asChild className="w-fit gap-1.5">
          <Link to="/projects">
            <ArrowLeft className="size-3.5" /> 返回项目列表
          </Link>
        </Button>
      </div>
    );
  }

  const cpuPct = calculatePercentage(usage?.cpu_milli, project.budget_cpu_milli);
  const memPct = calculatePercentage(usage?.mem_bytes, project.budget_mem_bytes);
  const diskPct = calculatePercentage(usage?.disk_bytes, project.budget_disk_bytes);

  const navTabs = [
    { key: "overview", label: "项目概览", icon: LayoutDashboard, route: `/projects/${id}`, testId: "project-tab-overview" },
    { key: "workspaces", label: "工作区服务器", icon: Box, route: `/projects/${id}/workspaces`, testId: "project-tab-workspaces" },
    { key: "members", label: "成员与权限", icon: Users, route: `/projects/${id}/members`, testId: "project-tab-members" },
    { key: "settings", label: "设置与预算", icon: Settings, route: `/projects/${id}/settings`, testId: "project-tab-settings" },
  ];

  return (
    <div className="flex flex-col gap-4 max-w-7xl mx-auto w-full h-full min-h-0 overflow-hidden">
      {/* 顶部紧凑标题与信息栏（固定在顶部，不随中间内容滚动） */}
      <div className="shrink-0 flex flex-col gap-3 pb-3 border-b border-border/60">
        {/* 移动端专属返回条 */}
        <div className="flex md:hidden items-center justify-between gap-2 text-xs text-muted-foreground pb-1">
          <Link
            to="/projects"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors font-medium"
          >
            <ArrowLeft className="size-3.5" />
            <span>全部项目</span>
          </Link>
          {project.my_role && (
            <Badge variant="outline" className="text-[10px] font-medium uppercase px-1.5 py-0 shrink-0">
              <Shield className="size-2.5 opacity-60 text-primary shrink-0" />
              {project.my_role}
            </Badge>
          )}
        </div>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20 shadow-xs">
              <FolderKanban className="size-4.5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="m-0 text-lg md:text-xl font-bold tracking-tight text-foreground">{project.name}</h2>
                <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 bg-muted/40 border-border/70 shrink-0">
                  {project.slug}
                </Badge>
                {project.my_role && (
                  <Badge variant="outline" className="hidden md:inline-flex text-[11px] font-medium uppercase px-2 py-0.5 shrink-0 whitespace-nowrap">
                    <Shield className="size-3 opacity-60 text-primary shrink-0" />
                    角色: {project.my_role}
                  </Badge>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                <Hint label={project.id}>
                  <span className="font-mono text-[11px] select-all opacity-80 truncate max-w-[10rem] sm:max-w-[20rem]" data-testid="project-id">
                    {project.id}
                  </span>
                </Hint>
                <Hint label={copied ? "已复制到剪贴板" : "复制完整项目 ID"}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    data-testid="project-copy-id"
                    onClick={onCopyId}
                    className={cn(
                      "size-5 p-0 shrink-0 text-muted-foreground hover:text-foreground transition-colors",
                      copied && "text-emerald-500 bg-emerald-500/10",
                    )}
                    aria-label="复制项目 ID"
                  >
                    {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3 opacity-60" />}
                  </Button>
                </Hint>
                {project.created_at && (
                  <>
                    <span className="opacity-30">·</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                      <Clock className="size-3 opacity-60" />
                      {formatTime(project.created_at)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:shrink-0">
            {isOwnerOrAdmin && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="compact"
                  data-testid="project-edit"
                  onClick={() => {
                    setEditErr("");
                    setEditOpen(true);
                  }}
                  className="h-7.5 px-3 text-xs gap-1.5 shrink-0"
                >
                  <Edit3 className="size-3.5 shrink-0" />
                  编辑项目
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  data-testid="project-delete"
                  onClick={() => setDeleteOpen(true)}
                  disabled={removing}
                  className="h-7.5 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5 shrink-0"
                >
                  <Trash2 className="size-3.5 shrink-0" />
                  删除
                </Button>
              </>
            )}
          </div>
        </div>

        {/* 仅在移动端显示的水平导航 Tabs（桌面端已有左侧二级菜单栏，避免重复） */}
        <div
          ref={tabsRef}
          className="flex md:hidden relative items-center gap-1 overflow-x-auto pt-2 border-t border-border/60 scrollbar-none"
          data-testid="project-mobile-tabs"
          {...tabsHover.handlers}
        >
          <FluidHoverHighlight hover={tabsHover} className="rounded-lg bg-hover" />
          {navTabs.map((tab, idx) => (
            <NavTabItem
              key={tab.key}
              index={idx}
              registerItem={tabsHover.registerItem}
              label={tab.label}
              icon={tab.icon}
              isActive={activeSection === tab.key}
              testId={tab.testId}
              onClick={() => navigate(tab.route)}
            />
          ))}
        </div>
      </div>

      {/* 错误通知 */}
      {usageErr && (
        <div className="shrink-0">
          <Alert variant="destructive">
            <AlertDescription>{usageErr}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* 视图分发 */}
      {activeSection === "overview" && (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 flex flex-col gap-6 pb-6">
          {/* 配额与用量仪表卡片组 */}
          <div>
            <div className="flex items-center justify-between mb-3 px-0.5">
              <h3 className="m-0 text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                <Activity className="size-4 text-primary" />
                资源配额与硬占用账本
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => void loadUsage()}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
              >
                <RefreshCw className="size-3" />
                刷新用量
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5" data-testid="project-usage">
              {/* CPU */}
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-4 shadow-surface-1 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-muted-foreground mb-2">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <Cpu className="size-3.5 text-primary" /> CPU 算力
                    </span>
                    <span className="text-[11px] font-mono">{cpuPct !== null ? `${cpuPct}%` : "未限额"}</span>
                  </div>
                  <div className="text-xl font-bold tracking-tight text-foreground font-mono">
                    {usage ? formatCpuMilli(usage.cpu_milli) : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    预算上限: {formatBudget(project.budget_cpu_milli, "cpu")}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-300", getProgressColor(cpuPct))}
                      style={{ width: `${cpuPct ?? 10}%` }}
                    />
                  </div>
                </div>
              </Elevated>

              {/* 内存 */}
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-4 shadow-surface-1 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-muted-foreground mb-2">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <Database className="size-3.5 text-primary" /> 内存容量
                    </span>
                    <span className="text-[11px] font-mono">{memPct !== null ? `${memPct}%` : "未限额"}</span>
                  </div>
                  <div className="text-xl font-bold tracking-tight text-foreground font-mono">
                    {usage ? formatBytes(usage.mem_bytes) : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    预算上限: {formatBudget(project.budget_mem_bytes, "bytes")}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-300", getProgressColor(memPct))}
                      style={{ width: `${memPct ?? 10}%` }}
                    />
                  </div>
                </div>
              </Elevated>

              {/* 磁盘 */}
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-4 shadow-surface-1 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-muted-foreground mb-2">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <HardDrive className="size-3.5 text-primary" /> 磁盘存储
                    </span>
                    <span className="text-[11px] font-mono">{diskPct !== null ? `${diskPct}%` : "未限额"}</span>
                  </div>
                  <div className="text-xl font-bold tracking-tight text-foreground font-mono">
                    {usage ? formatBytes(usage.disk_bytes) : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    预算上限: {formatBudget(project.budget_disk_bytes, "bytes")}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-300", getProgressColor(diskPct))}
                      style={{ width: `${diskPct ?? 10}%` }}
                    />
                  </div>
                </div>
              </Elevated>

              {/* 服务器数量 */}
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-4 shadow-surface-1 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-muted-foreground mb-2">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <Server className="size-3.5 text-primary" /> 工作区服务器
                    </span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {runningWsCount} 运行中
                    </Badge>
                  </div>
                  <div className="text-xl font-bold tracking-tight text-foreground font-mono">
                    {usage ? usage.workspaces : workspaces.length} <span className="text-xs font-normal text-muted-foreground">台实例</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    活跃隔离容器环境
                  </div>
                </div>
                <div className="mt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    onClick={() => navigate(`/projects/${id}/workspaces`)}
                    className="w-full justify-between h-7 text-xs text-muted-foreground hover:text-foreground px-2"
                  >
                    <span>查看服务器列表</span>
                    <ExternalLink className="size-3" />
                  </Button>
                </div>
              </Elevated>
            </div>
          </div>

          {/* 快速管理捷径 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-4 shadow-surface-1 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <h4 className="m-0 text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Box className="size-4 text-primary" />
                  工作区服务器
                </h4>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  项目内申请的隔离 Linux 环境，支持一键 Bastion SSH 直连及套餐扩缩容。
                </p>
              </div>
              <Button
                type="button"
                size="compact"
                onClick={() => navigate(`/projects/${id}/workspaces`)}
                className="shrink-0 h-8 px-3 text-xs gap-1.5"
              >
                <Server className="size-3.5" />
                管理服务器
              </Button>
            </Elevated>

            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-4 shadow-surface-1 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <h4 className="m-0 text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Users className="size-4 text-primary" />
                  协作成员与权限
                </h4>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  添加团队成员、分配 admin/developer 角色，管理 SSH 连接授权与读写模式。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="compact"
                onClick={() => navigate(`/projects/${id}/members`)}
                className="shrink-0 h-8 px-3 text-xs gap-1.5"
              >
                <Users className="size-3.5" />
                成员名单
              </Button>
            </Elevated>
          </div>

          {/* 近期服务器预览 */}
          <Elevated
            offset={1}
            shadowLevel={1}
            className="rounded-xl border border-border/80 bg-surface-1 p-5 shadow-surface-1 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h4 className="m-0 text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Server className="size-4 text-primary" />
                近期服务器实例 ({workspaces.length})
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => navigate(`/projects/${id}/workspaces`)}
                className="h-7 text-xs text-muted-foreground hover:text-foreground px-2 gap-1"
              >
                <span>完整管理</span>
                <ExternalLink className="size-3" />
              </Button>
            </div>

            {loadingWs ? (
              <div className="py-4 text-center text-xs text-muted-foreground">加载工作区中…</div>
            ) : workspaces.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-xs text-muted-foreground m-0">当前项目下暂无工作区服务器</p>
                <Button
                  type="button"
                  variant="outline"
                  size="compact"
                  onClick={() => navigate(`/projects/${id}/workspaces`)}
                  className="mt-2.5 h-7 text-xs gap-1"
                >
                  <Plus className="size-3" /> 申请第一台服务器
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {workspaces.slice(0, 5).map((ws) => (
                  <div key={ws.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("size-2 rounded-full shrink-0", workspaceStatusDotClass(ws.status))} />
                      <span className="font-semibold text-foreground truncate">{ws.name}</span>
                      <span className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded border border-border/50 inline-flex items-center gap-1 shrink-0">
                        <Cpu className="size-3 shrink-0 opacity-70" />
                        {ws.plan} · {ws.arch}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Hint label={ws.status} className="font-mono">
                        <span className="inline-flex">
                          <Badge
                            variant={workspaceStatusVariant(ws.status)}
                            size="compact"
                            className="text-[10px] whitespace-nowrap shrink-0"
                          >
                            {statusLabel(ws.status)}
                          </Badge>
                        </span>
                      </Hint>
                      <Button
                        type="button"
                        variant="ghost"
                        size="compact"
                        asChild
                        className="h-6 px-2 text-xs shrink-0"
                      >
                        <Link to={`/workspaces/${ws.id}`}>控制台</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Elevated>
        </div>
      )}

      {/* 视图二：工作区服务器 (Workspaces) */}
      {activeSection === "workspaces" && (
        <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3 shrink-0">
            <div>
              <h3 className="m-0 text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                <Box className="size-4 text-primary" />
                项目工作区服务器
              </h3>
              <p className="m-0 mt-1 text-xs text-muted-foreground">
                当前项目内申请的隔离环境。具有对应权限的成员可通过 Bastion 跳板机进行 SSH 直连。
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="compact"
                data-testid="ws-refresh"
                onClick={() => void refetchWs()}
                className="h-8 px-3 text-xs gap-1.5 shrink-0"
              >
                <RefreshCw className={cn("size-3.5", loadingWs && "animate-spin")} />
                刷新
              </Button>
              <CreateForm
                projects={projectOptions}
                initialProjectId={id}
                onCreated={() => {
                  wsPollUntilRef.current = Date.now() + WORKSPACE_POLL_AFTER_MUTATION_MS;
                  void refetchWs();
                  void loadUsage();
                }}
                onError={(msg) => setWsErr(msg)}
                canApprove={canApproveRole(project.my_role, me?.platform_role)}
                platformRole={me?.platform_role}
                trigger={
                  <Button size="compact" data-testid="ws-create" className="h-8 px-3 text-xs font-medium gap-1.5 shrink-0">
                    <Plus className="size-3.5" />
                    新建工作区
                  </Button>
                }
              />
            </div>
          </div>

          {wsErr && (
            <div className="shrink-0 pb-2">
              <Alert variant="destructive">
                <AlertDescription>{wsErr}</AlertDescription>
              </Alert>
            </div>
          )}
          {wsToast && (
            <div className="shrink-0 pb-2">
              <Alert>
                <AlertDescription>{wsToast}</AlertDescription>
              </Alert>
            </div>
          )}

          {loadingWs ? (
            <div className="py-12 text-center min-h-0 flex-1 flex items-center justify-center">
              <Loading label="加载工作区列表…" />
            </div>
          ) : workspaces.length === 0 ? (
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 p-10 shadow-surface-2 text-center my-auto"
            >
              <Empty
                text="当前项目还没有创建工作区服务器"
                description="点击右上角「新建工作区」按钮，即可为本项目申请隔离的容器实例。"
              />
            </Elevated>
          ) : (
            <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
              <Elevated
                offset={1}
                shadowLevel={2}
                className="rounded-xl border border-border/80 bg-surface-1 shadow-surface-2 min-h-0 flex-1 flex flex-col overflow-hidden"
              >
                <div className="w-full min-h-0 flex-1 overflow-auto">
                  <Table className="min-w-[880px]">
                    <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none sticky top-0 z-20 backdrop-blur-sm">
                      <TableRow className="border-b border-border/60 hover:bg-transparent">
                        <TableHead className="font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                          工作区名称
                        </TableHead>
                        <TableHead className="w-[120px] font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                          状态
                        </TableHead>
                        <TableHead className="w-[180px] font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                          配置规格
                        </TableHead>
                        <TableHead className="w-[160px] font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                          宿主机节点
                        </TableHead>
                        <TableHead className="w-[160px] font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                          创建时间
                        </TableHead>
                        <TableHead stickyEnd className="w-[200px] text-right font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5 pr-4">
                          操作
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wsPager.slice.map((ws) => (
                        <WorkspaceRow
                          key={ws.id}
                          ws={ws}
                          busyId={busyWsId}
                          canApprove={canApproveRole(project.my_role, me?.platform_role)}
                          platformRole={me?.platform_role}
                          myRole={project.my_role}
                          mySshAccess={project.my_ssh_access}
                          projectId={id}
                          onBusy={setBusyWsId}
                          onRefresh={() => {
                            wsPollUntilRef.current = Date.now() + WORKSPACE_POLL_AFTER_MUTATION_MS;
                            void loadUsage();
                            return refetchWs();
                          }}
                          onToast={(m) => {
                            setWsToast(m);
                            setTimeout(() => setWsToast(null), 3000);
                          }}
                          onError={(e) => setWsErr(e)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Elevated>

              {/* 底部固定分页器 */}
              <div className="shrink-0 pt-3 border-t border-border/60">
                <Paginator
                  page={wsPager.page}
                  pageCount={wsPager.pageCount}
                  pageSize={wsPager.pageSize}
                  total={wsPager.total}
                  onPageChange={wsPager.setPage}
                  onPageSizeChange={wsPager.setPageSize}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 视图三：成员与权限 (Members) */}
      {activeSection === "members" && (
        <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <Elevated
            offset={1}
            shadowLevel={2}
            className="rounded-2xl border border-border/80 bg-surface-1 p-5 shadow-surface-2 min-h-0 flex-1 flex flex-col overflow-hidden"
          >
            <MemberList projectId={id} projectName={project.name} />
          </Elevated>
        </div>
      )}

      {/* 视图四：设置与预算 (Settings) */}
      {activeSection === "settings" && (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 flex flex-col gap-6 pb-6">
          {/* 基本信息设置 */}
          <Elevated
            offset={1}
            shadowLevel={1}
            className="rounded-2xl border border-border/80 bg-surface-1 p-6 shadow-surface-1 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div>
                <h3 className="m-0 text-base font-semibold text-foreground">基本信息</h3>
                <p className="m-0 mt-1 text-xs text-muted-foreground">修改项目显示名称与系统唯一标识 Slug。</p>
              </div>
              {isOwnerOrAdmin && (
                <Button
                  type="button"
                  variant="outline"
                  size="compact"
                  onClick={() => {
                    setEditErr("");
                    setEditOpen(true);
                  }}
                  className="h-8 px-3 text-xs gap-1.5"
                >
                  <Edit3 className="size-3.5" />
                  修改信息
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground block mb-1">项目名称</span>
                <span className="font-semibold text-foreground text-sm">{project.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">系统 Slug</span>
                <span className="font-mono bg-muted/40 px-2 py-1 rounded border border-border/60 text-foreground">
                  {project.slug}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">项目唯一 ID</span>
                <span className="font-mono text-muted-foreground select-all">{project.id}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">创建时间</span>
                <span className="text-muted-foreground">{formatTime(project.created_at)}</span>
              </div>
            </div>
          </Elevated>

          {/* 硬占用预算配额卡片 */}
          <Elevated
            offset={1}
            shadowLevel={1}
            className="rounded-2xl border border-border/80 bg-surface-1 p-6 shadow-surface-1 flex flex-col gap-4"
          >
            <div className="border-b border-border/60 pb-3">
              <h3 className="m-0 text-base font-semibold text-foreground flex items-center gap-2">
                <Activity className="size-4 text-primary" />
                项目硬占用预算 (Quota Limits)
              </h3>
              <p className="m-0 mt-1 text-xs text-muted-foreground">
                由项目 Owner 或管理员配置。设置为 <strong>0</strong> 表示不设预算上限（按平台全局套餐上限控制）。
                单位：milli-CPU（1000 = 1 核）、字节（内存与磁盘）。
              </p>
            </div>

            <form className="grid gap-4 max-w-xl" onSubmit={onSaveBudget}>
              <Field
                label={
                  <div className="flex items-center justify-between w-full">
                    <span>CPU 算力配额 (budget_cpu_milli)</span>
                    {budgetCpu.trim() && parseBudgetInput(budgetCpu) !== null && (
                      <span className="text-xs font-mono text-primary font-normal">
                        ≈ {formatBudget(parseBudgetInput(budgetCpu)!, "cpu")}
                      </span>
                    )}
                  </div>
                }
              >
                <Input
                  inputMode="numeric"
                  value={budgetCpu}
                  onChange={(e) => setBudgetCpu(e.target.value)}
                  disabled={!isOwnerOrAdmin || savingBudget}
                  placeholder="0 (不设上限)"
                  data-testid="budget-cpu"
                  className="font-mono text-xs"
                />
              </Field>

              <Field
                label={
                  <div className="flex items-center justify-between w-full">
                    <span>内存配额 (budget_mem_bytes)</span>
                    {budgetMem.trim() && parseBudgetInput(budgetMem) !== null && (
                      <span className="text-xs font-mono text-primary font-normal">
                        ≈ {formatBudget(parseBudgetInput(budgetMem)!, "bytes")}
                      </span>
                    )}
                  </div>
                }
              >
                <Input
                  inputMode="numeric"
                  value={budgetMem}
                  onChange={(e) => setBudgetMem(e.target.value)}
                  disabled={!isOwnerOrAdmin || savingBudget}
                  placeholder="0 (不设上限)"
                  data-testid="budget-mem"
                  className="font-mono text-xs"
                />
              </Field>

              <Field
                label={
                  <div className="flex items-center justify-between w-full">
                    <span>磁盘配额 (budget_disk_bytes)</span>
                    {budgetDisk.trim() && parseBudgetInput(budgetDisk) !== null && (
                      <span className="text-xs font-mono text-primary font-normal">
                        ≈ {formatBudget(parseBudgetInput(budgetDisk)!, "bytes")}
                      </span>
                    )}
                  </div>
                }
              >
                <Input
                  inputMode="numeric"
                  value={budgetDisk}
                  onChange={(e) => setBudgetDisk(e.target.value)}
                  disabled={!isOwnerOrAdmin || savingBudget}
                  placeholder="0 (不设上限)"
                  data-testid="budget-disk"
                  className="font-mono text-xs"
                />
              </Field>

              {formErr && (
                <Alert variant="destructive" data-testid="project-error">
                  <AlertDescription>{formErr}</AlertDescription>
                </Alert>
              )}
              {formOk && <p className="text-xs font-medium text-emerald-500 m-0">{formOk}</p>}

              {isOwnerOrAdmin && (
                <div className="pt-1">
                  <Button
                    type="submit"
                    size="compact"
                    disabled={savingBudget}
                    data-testid="budget-save"
                    className="h-8 px-4 text-xs font-medium"
                  >
                    {savingBudget ? "正在保存…" : "保存预算配置"}
                  </Button>
                </div>
              )}
            </form>
          </Elevated>

          {/* 危险操作区域 (Danger Zone) */}
          {isOwnerOrAdmin && (
            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 shadow-surface-1 flex flex-col gap-3"
            >
              <h3 className="m-0 text-base font-bold text-destructive flex items-center gap-2">
                <Trash2 className="size-4 text-destructive" />
                危险区域 (Danger Zone)
              </h3>
              <p className="m-0 text-xs text-muted-foreground leading-relaxed">
                删除项目将同时移除该项目下的所有关联成员身份。如果项目内仍有运行中的工作区服务器，请先完成销毁终审流程。该操作不可撤销。
              </p>
              <div className="pt-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="compact"
                  data-testid="project-delete"
                  onClick={() => setDeleteOpen(true)}
                  disabled={removing}
                  className="h-8 px-3 text-xs font-medium gap-1.5"
                >
                  <Trash2 className="size-3.5" />
                  解散并删除该项目
                </Button>
              </div>
            </Elevated>
          )}
        </div>
      )}

      {/* 弹窗组件 */}
      <ProjectFormDialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditErr("");
        }}
        mode="edit"
        initial={{ name: project.name, slug: project.slug }}
        submitting={savingMeta}
        error={editErr}
        onSubmit={onSaveMeta}
      />
      <ProjectDeleteDialog
        open={deleteOpen}
        name={project.name}
        onOpenChange={setDeleteOpen}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
