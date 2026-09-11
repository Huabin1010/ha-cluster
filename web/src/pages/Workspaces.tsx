import { useCallback, useRef, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useGetIdentity, useList } from "@refinedev/core";
import { Server, Layers, Cpu, RefreshCw, FolderKanban, ShieldAlert, PlayCircle, Clock, HeartPulse, SlidersHorizontal } from "lucide-react";
import { isInsufficientCapacity, type AuthUser } from "@/providers";
import { Banner, Loading, useToast } from "@/ui";
import { CreateForm } from "@/pages/workspaces/CreateForm";
import { WorkspaceRow } from "@/pages/workspaces/WorkspaceRow";
import {
  canApproveRole,
  ProjectOption,
  Workspace,
  WORKSPACE_POLL_AFTER_MUTATION_MS,
  WORKSPACE_POLL_INTERVAL_MS,
  workspaceListQueryPollInterval,
} from "@/pages/workspaces/types";
import { Button } from "@/components/ui/button";
import { SelectBox } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageFrame } from "@/components/ui/page-frame";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { useClientPager } from "@/lib/use-client-pager";
import { writeCurrentProject } from "@/lib/current-project";

export function WorkspacesPage() {
  const toast = useToast();
  const { data: me } = useGetIdentity<AuthUser>();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get("project_id") || "";

  const [err, setErr] = useState("");
  const [insufficient, setInsufficient] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reloadUsageRef = useRef<(() => void) | undefined>(undefined);
  const pollUntilRef = useRef(0);

  const showError = useCallback((msg: string, isInsufficient = false) => {
    setErr(msg);
    setInsufficient(!!msg && (isInsufficient || isInsufficientCapacity(msg)));
  }, []);

  const { data: projectData } = useList<ProjectOption>({
    resource: "projects",
    pagination: { mode: "off" },
  });
  const { data, isLoading, refetch } = useList<Workspace>({
    resource: "workspaces",
    pagination: { mode: "off" },
    filters: projectFilter ? [{ field: "project_id", operator: "eq", value: projectFilter }] : [],
    errorNotification: false,
    queryOptions: {
      refetchInterval: (data) => {
        if (Date.now() < pollUntilRef.current) return WORKSPACE_POLL_INTERVAL_MS;
        return workspaceListQueryPollInterval(data);
      },
    },
  });

  const projects = projectData?.data ?? [];
  const selected = projects.find((p) => p.id === projectFilter);
  const canApprove = canApproveRole(selected?.my_role, me?.platform_role);
  const [showAbnormal, setShowAbnormal] = useState(false);
  const rows = useMemo(() => {
    const list = data?.data ?? [];
    return list.filter((w) => {
      if (w.status === "destroyed") return false;
      if (!showAbnormal && (w.status === "node_lost" || w.status === "failed")) return false;
      return true;
    });
  }, [data, showAbnormal]);
  const runningCount = rows.filter((w) => w.status === "running" || w.status === "fabric_degraded").length;
  const pending = rows.filter((w) => w.status === "requested").length;
  const pendingResize = rows.filter((w) => w.resize_status === "pending").length;
  const pendingDestroy = rows.filter((w) => w.status === "destroy_requested").length;
  const pager = useClientPager(rows, projectFilter);

  function setProjectFilter(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("project_id", id);
    else next.delete("project_id");
    writeCurrentProject(id);
    setSearchParams(next, { replace: true });
  }

  function kickPoll() {
    pollUntilRef.current = Date.now() + WORKSPACE_POLL_AFTER_MUTATION_MS;
  }

  function afterMutation() {
    kickPoll();
    reloadUsageRef.current?.();
    void refetch();
  }

  return (
    <PageFrame
      header={
        <div className="flex flex-col gap-4">
          {/* 顶栏标题与开通入口 */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20 shadow-xs">
                <Server className="size-4.5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">服务器</h2>
                  <Badge variant="outline" className="px-2 py-0.5 text-xs font-mono font-normal">
                    {rows.length} 台实例
                  </Badge>
                  {selected && (
                    <Badge variant="default" className="px-2 py-0.5 text-xs font-normal inline-flex items-center gap-1">
                      <FolderKanban className="size-3" />
                      当前项目: {selected.name}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 mb-0 text-sm text-muted-foreground">
                  项目隔离的 Linux 计算环境。升配：管理员直接生效，成员需审批。降配一律需审批。管理员销毁无需再走申请。
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <CreateForm
                projects={projects}
                initialProjectId={projectFilter}
                reloadUsageRef={reloadUsageRef}
                canApprove={canApprove}
                platformRole={me?.platform_role}
                onCreated={() => {
                  showError("");
                  toast.show(canApprove ? "创建成功" : "已提交申请，等待管理员审批", "success");
                  afterMutation();
                }}
                onError={showError}
              />
            </div>
          </div>

          {/* 统计指标卡片条 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-3 shadow-surface-1 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Server className="size-3.5 text-primary" /> 全部服务器
                </span>
              </div>
              <div className="text-lg font-bold tracking-tight text-foreground font-mono mt-1">
                {rows.length} <span className="text-xs font-normal text-muted-foreground">台</span>
              </div>
            </Elevated>

            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-3 shadow-surface-1 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <PlayCircle className="size-3.5 text-emerald-500" /> 运行中
                </span>
              </div>
              <div className="text-lg font-bold tracking-tight text-foreground font-mono mt-1">
                {runningCount} <span className="text-xs font-normal text-muted-foreground">台</span>
              </div>
            </Elevated>

            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-3 shadow-surface-1 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Clock className="size-3.5 text-amber-500" /> 待审批申请
                </span>
              </div>
              <div className="text-lg font-bold tracking-tight text-foreground font-mono mt-1">
                {pending + pendingResize} <span className="text-xs font-normal text-muted-foreground">条</span>
              </div>
            </Elevated>

            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-3 shadow-surface-1 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5 text-rose-500" /> 销毁待审
                </span>
              </div>
              <div className="text-lg font-bold tracking-tight text-foreground font-mono mt-1">
                {pendingDestroy} <span className="text-xs font-normal text-muted-foreground">条</span>
              </div>
            </Elevated>
          </div>

          {/* 审批与通知横幅 */}
          {pending > 0 && canApprove && (
            <Banner kind="info">
              <span data-testid="ws-pending-banner">有 {pending} 条服务器申请待审批</span>
            </Banner>
          )}
          {pendingResize > 0 && canApprove && (
            <Banner kind="info">
              <span data-testid="ws-resize-banner">有 {pendingResize} 条扩/降配申请待审批</span>
            </Banner>
          )}
          {pendingDestroy > 0 && canApprove && (
            <Banner kind="info">
              <span data-testid="ws-destroy-banner">有 {pendingDestroy} 条销毁申请待项目初审</span>
            </Banner>
          )}
          {err && (
            <Banner
              kind="error"
              className={insufficient ? "ws-insufficient border-destructive" : undefined}
              onClose={() => showError("")}
            >
              <span data-testid="ws-error">{err}</span>
            </Banner>
          )}

          {/* 过滤与操作栏 */}
          <Elevated
            offset={1}
            shadowLevel={1}
            className="rounded-xl border border-border/80 bg-surface-1 p-3 shadow-surface-1 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="text-xs font-medium text-muted-foreground shrink-0 flex items-center gap-1.5">
                <FolderKanban className="size-3.5 text-primary" />
                项目筛选:
              </span>
              <div className="w-full max-w-xs sm:max-w-sm">
                <SelectBox
                  testId="ws-filter-project"
                  value={projectFilter || "__all__"}
                  onValueChange={(v) => setProjectFilter(v === "__all__" ? "" : v)}
                  placeholder="全部项目"
                  options={[
                    { value: "__all__", label: "全部项目" },
                    ...projects.map((p) => ({ value: p.id, label: `${p.name} (${p.slug})` })),
                  ]}
                />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant={showAbnormal ? "secondary" : "outline"}
                size="compact"
                data-testid="ws-show-abnormal"
                className="h-8 px-3 text-xs gap-1.5 shrink-0"
                onClick={() => setShowAbnormal((v) => !v)}
              >
                <ShieldAlert className="size-3.5 opacity-70 shrink-0" />
                {showAbnormal ? "隐藏异常" : "含异常"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="compact"
                data-testid="ws-refresh"
                onClick={() => void refetch()}
                className="h-8 px-3 text-xs gap-1.5 shrink-0"
              >
                <RefreshCw className="size-3.5 opacity-70 shrink-0" />
                刷新列表
              </Button>
            </div>
          </Elevated>
        </div>
      }
      footer={
        <Paginator
          page={pager.page}
          pageCount={pager.pageCount}
          pageSize={pager.pageSize}
          total={pager.total}
          onPageChange={pager.setPage}
          onPageSizeChange={pager.setPageSize}
        />
      }
    >
      {isLoading ? (
        <div className="py-12 text-center">
          <Loading label="加载服务器…" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center">
          <Elevated
            offset={1}
            shadowLevel={2}
            className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-md w-full flex flex-col items-center gap-3"
          >
            <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
              <Server className="size-6" />
            </div>
            <div>
              <h3 className="m-0 text-base font-semibold text-foreground">
                {projectFilter ? "该项目下暂无服务器" : "集群中暂无服务器"}
              </h3>
              <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                点击右上角「开通服务器」即可为项目申请独立的隔离 Linux 容器环境，获得专属 IP 与 SSH 极速跳板连接。
              </p>
            </div>
          </Elevated>
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
          <Table className="min-w-[900px]">
            <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none">
              <TableRow className="border-b border-border/60 hover:bg-transparent">
                <TableHead className="py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Server className="size-3.5 opacity-60 shrink-0" />
                    服务器名称
                  </span>
                </TableHead>
                <TableHead className="w-[140px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <HeartPulse className="size-3.5 opacity-60 shrink-0" />
                    状态
                  </span>
                </TableHead>
                <TableHead className="w-[220px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Layers className="size-3.5 opacity-60 shrink-0" />
                    配置规格
                  </span>
                </TableHead>
                <TableHead className="w-[160px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Cpu className="size-3.5 opacity-60 shrink-0" />
                    宿主机节点
                  </span>
                </TableHead>
                <TableHead className="w-[160px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Clock className="size-3.5 opacity-60 shrink-0" />
                    创建时间
                  </span>
                </TableHead>
                <TableHead className="w-[320px] text-right py-2.5 pr-4">
                  <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">
                    <SlidersHorizontal className="size-3.5 opacity-60 shrink-0" />
                    快捷操作
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((ws) => (
                <WorkspaceRow
                  key={ws.id}
                  ws={ws}
                  busyId={busyId}
                  canApprove={canApprove}
                  platformRole={me?.platform_role}
                  myRole={selected?.my_role}
                  mySshAccess={selected?.my_ssh_access}
                  projectId={projectFilter}
                  onBusy={setBusyId}
                  onRefresh={() => {
                    kickPoll();
                    void refetch();
                  }}
                  onToast={(m) => toast.show(m, "success")}
                  onError={(e) => showError(e)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageFrame>
  );
}
