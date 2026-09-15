import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CanAccess, useCustomMutation, useGetIdentity, useList } from "@refinedev/core";
import { Activity, Check, Clock, Copy, Globe, Hash, Layers, RefreshCw, Shield, User } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListCard, ListCardHeader, ListCardMeta, ResponsiveList } from "@/components/ui/responsive-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { canManageUsers } from "@/lib/permissions";
import { api, ApiError, friendlyError, isApiError, type AuthUser } from "@/providers";
import { Hint } from "@/components/ui/tooltip";
import { Loading } from "@/ui";
import { copyText } from "@/ui/format";
import { type Workspace } from "@/pages/workspaces/types";
import {
  actionBadgeStyle,
  actionLabel,
  auditActorLabel,
  auditChangeSummary,
  auditCopySnippet,
  auditPreferredName,
  auditResourceExists,
  auditResourceHref,
  auditResourceName,
  auditResourceProbe,
  canOpenAuditResource,
  fmtTime,
  isSSHExecAction,
  resourceTypeLabel,
} from "./format";
import { actorHoverUser, AuditActorHover, AuditTargetHover, type AuditHoverProject, type AuditHoverUser } from "./audit-hover";
import { AuditExecCommandButton, AuditExecResultDialog } from "./audit-exec";
import { useClientPager } from "@/lib/use-client-pager";
import { cn } from "@/lib/utils";

type AuditLog = {
  id: number;
  actor_user_id: string;
  actor_username?: string;
  actor_display_name?: string;
  resource_name?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip?: string;
  meta?: Record<string, unknown>;
  created_at: string;
};

type ReconcileResult = { released: number; stale_nodes: number };

type VisibleSets = {
  workspaces: Set<string>;
  projects: Set<string>;
};

function Forbidden() {
  return (
    <PageFrame
      header={
        <div className="flex items-center gap-3">
          <span className="size-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0 border border-destructive/20 shadow-xs">
            <Shield className="size-4.5" />
          </span>
          <div>
            <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">审计日志</h2>
            <p className="mt-1 mb-0 text-sm text-muted-foreground">访问受限</p>
          </div>
        </div>
      }
    >
      <div className="py-8 flex justify-center">
        <Elevated
          offset={1}
          shadowLevel={2}
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 max-w-md w-full text-center flex flex-col items-center gap-3"
          data-testid="audit-forbidden"
        >
          <Shield className="size-10 text-destructive" />
          <h3 className="m-0 text-base font-semibold text-foreground">无权访问审计日志</h3>
          <p className="m-0 text-xs text-muted-foreground leading-relaxed">
            没有权限查看审计日志。仅 platform_admin 或 platform_ops 等平台运维管理角色可查阅安全审计记录。
          </p>
        </Elevated>
      </div>
    </PageFrame>
  );
}

function AuditActionBadge({ action }: { action: string }) {
  const style = actionBadgeStyle(action);
  return (
    <Hint label={action} className="font-mono">
      <Badge
        variant={style.variant}
        color={style.color}
        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0"
      >
        {actionLabel(action)}
      </Badge>
    </Hint>
  );
}

function auditLogDisplayName(log: AuditLog, workspaces: Workspace[], projects: AuditHoverProject[]): string {
  const workspace = workspaces.find((w) => w.id === log.resource_id);
  const projectId = log.resource_type === "project" ? log.resource_id : workspace?.project_id;
  const project = projects.find((p) => p.id === projectId);
  const liveName =
    log.resource_type === "workspace" ? workspace?.name : log.resource_type === "project" ? project?.name : "";
  return auditResourceName(
    log.resource_type,
    log.resource_id,
    log.meta,
    auditPreferredName(log.resource_type, log.meta, liveName, log.resource_name),
  );
}

function AuditTargetCell({
  log,
  me,
  visible,
  logs,
  workspaces,
  projects,
  listsReady,
  onOpenExec,
}: {
  log: AuditLog;
  me?: AuthUser;
  visible: VisibleSets;
  logs: AuditLog[];
  workspaces: Workspace[];
  projects: AuditHoverProject[];
  listsReady: boolean;
  onOpenExec?: (log: AuditLog) => void;
}) {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const exec = isSSHExecAction(log.action);
  const change = exec ? "" : auditChangeSummary(log.action, log.meta);
  const command = exec ? String(log.meta?.command ?? "") : "";
  const name = auditLogDisplayName(log, workspaces, projects);
  const href = auditResourceHref(log.resource_type, log.resource_id, log.meta);
  const canOpen = canOpenAuditResource(log.resource_type, log.resource_id, log.meta, {
    userId: me?.id,
    platformRole: me?.platform_role,
    visibleWorkspaceIds: visible.workspaces,
    visibleProjectIds: visible.projects,
  });
  const to = canOpen && href ? href : "";
  const workspace = workspaces.find((w) => w.id === log.resource_id);
  const projectId = log.resource_type === "project" ? log.resource_id : workspace?.project_id;
  const project = projects.find((p) => p.id === projectId);
  const liveKnown =
    log.resource_type === "workspace"
      ? workspace
        ? true
        : listsReady
          ? false
          : undefined
      : log.resource_type === "project"
        ? project
          ? true
          : listsReady
            ? false
            : undefined
        : undefined;

  async function openTarget(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!to) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (opening) return;
    if (liveKnown === true) {
      navigate(to);
      return;
    }
    if (liveKnown === false) {
      toast.error("资源已被销毁");
      return;
    }
    setOpening(true);
    try {
      const exists = await auditResourceExists(
        auditResourceProbe(log.resource_type, log.resource_id, log.meta),
        (path) => api(path),
      );
      if (!exists) {
        toast.error("资源已被销毁");
        return;
      }
      navigate(to);
    } catch (err) {
      if (isApiError(err) && err.status === 404) {
        toast.error("资源已被销毁");
        return;
      }
      toast.error(friendlyError(err));
    } finally {
      setOpening(false);
    }
  }

  const nameRow = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap min-w-0">
      <span className="text-muted-foreground shrink-0">{resourceTypeLabel(log.resource_type)}</span>
      <span
        className={cn(
          "font-medium truncate",
          to ? "text-primary hover:underline underline-offset-2" : "text-foreground",
        )}
      >
        {name}
      </span>
    </span>
  );

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <AuditTargetHover
        type={log.resource_type}
        id={log.resource_id}
        name={name}
        canOpen={canOpen}
        logs={logs}
        workspace={workspace}
        project={project}
      >
        {to ? (
          <Link
            to={to}
            data-testid="audit-target-link"
            className={cn("min-w-0 max-w-full block", opening && "pointer-events-none opacity-70")}
            onClick={(e) => void openTarget(e)}
          >
            {nameRow}
          </Link>
        ) : (
          <div className={cn("min-w-0", to ? "cursor-pointer" : "cursor-help")}>{nameRow}</div>
        )}
      </AuditTargetHover>
      {exec && command ? <AuditExecCommandButton command={command} onOpen={() => onOpenExec?.(log)} /> : null}
      {!exec && change ? (
        <span className="text-foreground break-words min-w-0 leading-snug">{change}</span>
      ) : null}
    </div>
  );
}

function AuditCopyButton({
  log,
  name,
  copied,
  onCopied,
}: {
  log: AuditLog;
  name: string;
  copied: boolean;
  onCopied: (id: number) => void;
}) {
  return (
    <Hint label={copied ? "已复制" : "复制排查信息"}>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className="size-6 p-0 shrink-0 inline-flex items-center justify-center"
        data-testid="audit-copy"
        aria-label="复制排查信息"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void (async () => {
            const ok = await copyText(auditCopySnippet(log, name));
            if (!ok) {
              toast.error("复制失败，请手动选中");
              return;
            }
            onCopied(log.id);
            toast.success("已复制排查信息");
          })();
        }}
      >
        {copied ? (
          <Check className="size-3 text-emerald-500 shrink-0" />
        ) : (
          <Copy className="size-3 opacity-60 shrink-0" />
        )}
      </Button>
    </Hint>
  );
}

function AuditList() {
  const { data: me } = useGetIdentity<AuthUser>();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [execLog, setExecLog] = useState<AuditLog | null>(null);
  const canReconcile = me?.platform_role === "platform_admin";
  const canListUsers = canManageUsers(me?.platform_role);
  const { data, isLoading, error, refetch } = useList<AuditLog>({
    resource: "audit-logs",
    pagination: { mode: "off" },
    errorNotification: false,
    queryOptions: { retry: false },
  });
  const { data: workspaceData, isLoading: workspacesLoading } = useList<Workspace>({
    resource: "workspaces",
    pagination: { mode: "off" },
  });
  const { data: projectData, isLoading: projectsLoading } = useList<AuditHoverProject>({
    resource: "projects",
    pagination: { mode: "off" },
  });
  const { data: userData } = useList<AuditHoverUser>({
    resource: "users",
    pagination: { mode: "off" },
    errorNotification: false,
    queryOptions: { enabled: canListUsers, retry: false },
  });
  const workspaces = workspaceData?.data ?? [];
  const projects = projectData?.data ?? [];
  const listsReady = !workspacesLoading && !projectsLoading;
  const users = userData?.data ?? [];
  const visible = useMemo<VisibleSets>(
    () => ({
      workspaces: new Set(workspaces.map((w) => w.id)),
      projects: new Set(projects.map((p) => p.id)),
    }),
    [workspaces, projects],
  );
  const { mutate: reconcile, isLoading: reconciling } = useCustomMutation<ReconcileResult>();

  const forbidden = (error as ApiError | undefined)?.status === 403;
  if (forbidden) return <Forbidden />;

  const logs = data?.data ?? [];
  const pager = useClientPager(logs);

  return (
    <>
    <PageFrame
      header={
        <PageHeading
          icon={Activity}
          title="审计日志"
          badges={
            <Badge variant="outline" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal">
              {logs.length} 条近况
            </Badge>
          }
          description="记录平台核心安全与资源生命周期事件（登录、创建/销毁工作区、SSH 接入授权与对账轨迹）。"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="compact"
                onClick={() => void refetch()}
                data-testid="audit-refresh"
                className="h-8 px-3 text-xs gap-1.5 shrink-0"
              >
                <RefreshCw className="size-3.5 opacity-70 shrink-0" />
                刷新日志
              </Button>
              {canReconcile && (
                <Button
                  data-testid="audit-reconcile"
                  disabled={reconciling}
                  type="button"
                  size="compact"
                  className="h-8 px-3 text-xs gap-1.5 shrink-0"
                  onClick={() =>
                    reconcile({
                      url: "/admin/reconcile",
                      method: "post",
                      values: {},
                      successNotification: (res) => {
                        const out = res?.data;
                        return {
                          message: `对账完成：已释放 ${out?.released ?? 0} 条僵尸占用，标记 ${out?.stale_nodes ?? 0} 个失联节点。`,
                          type: "success",
                        };
                      },
                      errorNotification: (e) => ({
                        message: friendlyError(e),
                        type: "error",
                      }),
                    })
                  }
                >
                  <RefreshCw className={cn("size-3.5 shrink-0", reconciling && "animate-spin")} />
                  {reconciling ? "对账中…" : "系统对账"}
                </Button>
              )}
            </>
          }
        >

          {error && !forbidden && (
            <Alert variant="destructive">
              <AlertDescription>{friendlyError(error)}</AlertDescription>
            </Alert>
          )}
        </PageHeading>
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
          <Loading label="加载安全审计日志…" />
        </div>
      ) : logs.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center">
          <Elevated
            offset={1}
            shadowLevel={2}
            className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-md w-full flex flex-col items-center gap-3"
          >
            <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
              <Activity className="size-6" />
            </div>
            <div>
              <h3 className="m-0 text-base font-semibold text-foreground">暂无审计日志记录</h3>
              <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                当用户在平台进行登录、申请服务器、变更成员或执行敏感运维操作时，事件记录将实时流转至此。
              </p>
            </div>
          </Elevated>
        </div>
      ) : (
        <ResponsiveList
          table={
        <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
          <Table data-testid="audit-table" stackOnMobile={false} className="min-w-[850px]">
            <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none">
              <TableRow className="border-b border-border/60 hover:bg-transparent">
                <TableHead className="w-[120px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Hash className="size-3.5 opacity-60 shrink-0" />
                    ID
                  </span>
                </TableHead>
                <TableHead className="w-[180px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Clock className="size-3.5 opacity-60 shrink-0" />
                    触发时间
                  </span>
                </TableHead>
                <TableHead className="w-[160px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <User className="size-3.5 opacity-60 shrink-0" />
                    操作人
                  </span>
                </TableHead>
                <TableHead className="w-[160px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Activity className="size-3.5 opacity-60 shrink-0" />
                    安全动作
                  </span>
                </TableHead>
                <TableHead className="py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Layers className="size-3.5 opacity-60 shrink-0" />
                    操作目标与资源
                  </span>
                </TableHead>
                <TableHead className="w-[140px] py-2.5 pr-4 text-right">
                  <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">
                    <Globe className="size-3.5 opacity-60 shrink-0" />
                    来源 IP
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((l) => (
                <TableRow key={l.id} data-testid="audit-row">
                  <TableCell className="py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
                      <span className="mono font-mono text-xs text-muted-foreground">#{l.id}</span>
                      <AuditCopyButton
                        log={l}
                        name={auditLogDisplayName(l, workspaces, projects)}
                        copied={copiedId === l.id}
                        onCopied={(id) => {
                          setCopiedId(id);
                          window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
                        }}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="mono font-mono text-xs py-2.5 whitespace-nowrap text-muted-foreground">
                    {fmtTime(l.created_at)}
                  </TableCell>
                  <TableCell className="py-2.5 whitespace-nowrap">
                    <AuditActorHover
                      userId={l.actor_user_id}
                      displayName={l.actor_display_name}
                      username={l.actor_username}
                      logs={logs}
                      user={actorHoverUser(users, l.actor_user_id)}
                      workspaces={workspaces}
                    >
                      <span
                        data-testid="audit-actor"
                        className="cursor-help inline-flex items-center gap-1.5 font-medium text-foreground"
                      >
                        <User className="size-3 opacity-60 shrink-0" />
                        {auditActorLabel(l.actor_display_name, l.actor_username, l.actor_user_id)}
                      </span>
                    </AuditActorHover>
                  </TableCell>
                  <TableCell className="py-2.5 whitespace-nowrap">
                    <AuditActionBadge action={l.action} />
                  </TableCell>
                  <TableCell className="py-2.5 text-xs min-w-[220px] max-w-[420px]">
                    <AuditTargetCell
                      log={l}
                      me={me}
                      visible={visible}
                      logs={logs}
                      workspaces={workspaces}
                      projects={projects}
                      listsReady={listsReady}
                      onOpenExec={setExecLog}
                    />
                  </TableCell>
                  <TableCell className="mono font-mono text-xs py-2.5 text-right pr-4 whitespace-nowrap text-foreground">
                    {l.ip?.trim() ? l.ip : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
          }
          cards={pager.slice.map((l) => (
            <ListCard key={l.id} data-testid="audit-row">
              <ListCardHeader
                title={
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <AuditActionBadge action={l.action} />
                  </span>
                }
                trailing={
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
                    <span className="mono font-mono text-xs text-muted-foreground">#{l.id}</span>
                    <AuditCopyButton
                      log={l}
                      name={auditLogDisplayName(l, workspaces, projects)}
                      copied={copiedId === l.id}
                      onCopied={(id) => {
                        setCopiedId(id);
                        window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
                      }}
                    />
                  </span>
                }
              />
              <ListCardMeta className="text-foreground">
                <span className="inline-flex items-center gap-1 shrink-0 font-mono">
                  <Clock className="size-3 opacity-60 shrink-0" />
                  {fmtTime(l.created_at)}
                </span>
                <AuditActorHover
                  userId={l.actor_user_id}
                  displayName={l.actor_display_name}
                  username={l.actor_username}
                  logs={logs}
                  user={actorHoverUser(users, l.actor_user_id)}
                  workspaces={workspaces}
                >
                  <span data-testid="audit-actor" className="cursor-help inline-flex items-center gap-1.5 font-medium text-foreground">
                    <User className="size-3 opacity-60 shrink-0" />
                    {auditActorLabel(l.actor_display_name, l.actor_username, l.actor_user_id)}
                  </span>
                </AuditActorHover>
                <span className="inline-flex items-center gap-1 shrink-0 font-mono">
                  <Globe className="size-3 opacity-60 shrink-0" />
                  {l.ip?.trim() ? l.ip : "—"}
                </span>
              </ListCardMeta>
              <div className="mt-2 min-w-0 text-xs">
                <AuditTargetCell
                  log={l}
                  me={me}
                  visible={visible}
                  logs={logs}
                  workspaces={workspaces}
                  projects={projects}
                  listsReady={listsReady}
                  onOpenExec={setExecLog}
                />
              </div>
            </ListCard>
          ))}
        />
      )}
    </PageFrame>
    <AuditExecResultDialog
      open={execLog != null}
      onOpenChange={(next) => {
        if (!next) setExecLog(null);
      }}
      action={execLog?.action ?? "ssh.exec"}
      meta={execLog?.meta}
      resourceName={execLog ? auditLogDisplayName(execLog, workspaces, projects) : ""}
    />
    </>
  );
}

export function AuditPage() {
  return (
    <CanAccess
      resource="audit-logs"
      action="list"
      fallback={<Forbidden />}
    >
      <AuditList />
    </CanAccess>
  );
}
