import { CanAccess, useCustomMutation, useGetIdentity, useList } from "@refinedev/core";
import { Activity, Clock, Globe, Hash, Layers, RefreshCw, Shield, User } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageFrame } from "@/components/ui/page-frame";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { ApiError, friendlyError } from "@/providers";
import { Hint } from "@/components/ui/tooltip";
import { Loading } from "@/ui";
import { actionLabel, fmtTime, resourceLabel, shortId } from "./format";
import { useClientPager } from "@/lib/use-client-pager";
import { cn } from "@/lib/utils";

type AuditLog = {
  id: number;
  actor_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip?: string;
  created_at: string;
};

type Identity = { platform_role?: string };

type ReconcileResult = { released: number; stale_nodes: number };

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
        >
          <Shield className="size-10 text-destructive" />
          <h3 className="m-0 text-base font-semibold text-foreground">无权访问审计日志</h3>
          <p className="m-0 text-xs text-muted-foreground leading-relaxed">
            仅 platform_admin 或 platform_ops 等平台运维管理角色可查阅安全审计记录。
          </p>
        </Elevated>
      </div>
    </PageFrame>
  );
}

function actionVariant(action: string): "default" | "outline" | "ok" | "warn" | "danger" {
  if (action.includes("deny") || action.includes("delete") || action.includes("destroy") || action.includes("fail")) {
    return "danger";
  }
  if (action.includes("allow") || action.includes("success") || action.includes("approve")) {
    return "ok";
  }
  if (action.includes("request") || action.includes("pending")) {
    return "warn";
  }
  return "outline";
}

function AuditList() {
  const { data: me } = useGetIdentity<Identity>();
  const canReconcile = me?.platform_role === "platform_admin";
  const { data, isLoading, error, refetch } = useList<AuditLog>({
    resource: "audit-logs",
    pagination: { mode: "off" },
    errorNotification: false,
    queryOptions: { retry: false },
  });
  const { mutate: reconcile, isLoading: reconciling } = useCustomMutation<ReconcileResult>();

  const forbidden = (error as ApiError | undefined)?.status === 403;
  if (forbidden) return <Forbidden />;

  const logs = data?.data ?? [];
  const pager = useClientPager(logs);

  return (
    <PageFrame
      header={
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20 shadow-xs">
                <Activity className="size-4.5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">审计日志</h2>
                  <Badge variant="outline" className="px-2 py-0.5 text-xs font-mono font-normal">
                    {logs.length} 条近况
                  </Badge>
                </div>
                <p className="mt-1 mb-0 text-sm text-muted-foreground">
                  记录平台核心安全与资源生命周期事件（登录、创建/销毁工作区、SSH 接入授权与对账轨迹）。
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
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
            </div>
          </div>

          {error && !forbidden && (
            <Alert variant="destructive">
              <AlertDescription>{friendlyError(error)}</AlertDescription>
            </Alert>
          )}
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
        <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
          <Table className="min-w-[850px]">
            <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none">
              <TableRow className="border-b border-border/60 hover:bg-transparent">
                <TableHead className="w-[80px] py-2.5">
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
                    操作人 (actor)
                  </span>
                </TableHead>
                <TableHead className="w-[160px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Activity className="size-3.5 opacity-60 shrink-0" />
                    安全动作 (action)
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
                  <TableCell className="mono font-mono text-xs py-2.5 text-muted-foreground whitespace-nowrap">
                    #{l.id}
                  </TableCell>
                  <TableCell className="mono font-mono text-xs py-2.5 whitespace-nowrap text-muted-foreground">
                    {fmtTime(l.created_at)}
                  </TableCell>
                  <TableCell className="mono font-mono text-xs py-2.5 whitespace-nowrap">
                    <Hint label={l.actor_user_id}>
                      <span className="cursor-help bg-muted/40 px-1.5 py-0.5 rounded border border-border/50 text-foreground">
                        {shortId(l.actor_user_id)}
                      </span>
                    </Hint>
                  </TableCell>
                  <TableCell className="py-2.5 whitespace-nowrap">
                    <Hint label={l.action} className="font-mono">
                      <Badge variant={actionVariant(l.action)} className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                        {actionLabel(l.action)}
                      </Badge>
                    </Hint>
                  </TableCell>
                  <TableCell className="py-2.5 whitespace-nowrap text-xs">
                    <div className="inline-flex items-center gap-1.5 font-mono">
                      <span className="text-muted-foreground">{resourceLabel(l.resource_type)}:</span>
                      <Hint label={l.resource_id}>
                        <span className="text-foreground cursor-help underline decoration-dotted decoration-muted-foreground/60">
                          {shortId(l.resource_id)}
                        </span>
                      </Hint>
                    </div>
                  </TableCell>
                  <TableCell className="mono font-mono text-xs py-2.5 text-right pr-4 whitespace-nowrap text-muted-foreground">
                    {l.ip || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageFrame>
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
