import { CanAccess, useCustomMutation, useGetIdentity, useList } from "@refinedev/core";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { PageFrame } from "../../components/ui/page-frame";
import { Paginator } from "../../components/ui/pagination";
import { ApiError, friendlyError } from "../../providers";
import { Hint } from "../../components/ui/tooltip";
import { Empty, PageBody, PageHeader } from "../../ui";
import { actionLabel, fmtTime, resourceLabel, shortId } from "./format";
import { useClientPager } from "../../lib/use-client-pager";

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
    <section className="grid gap-3">
      <h2 className="m-0 text-xl font-semibold">审计日志</h2>
      <Alert variant="destructive" data-testid="audit-forbidden">
        <AlertDescription>你没有权限查看审计日志。</AlertDescription>
      </Alert>
      <p className="m-0 text-sm text-muted-foreground">仅 platform_admin / platform_ops 可访问此页。</p>
    </section>
  );
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
        <div className="grid gap-3">
          <PageHeader
            title="审计日志"
            description="最近 200 条平台操作记录（登录、创建 Workspace 等）。"
            actions={
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => void refetch()} data-testid="audit-refresh">
                  刷新
                </Button>
                {canReconcile && (
                  <Button
                    data-testid="audit-reconcile"
                    disabled={reconciling}
                    type="button"
                    onClick={() =>
                      reconcile({
                        url: "/admin/reconcile",
                        method: "post",
                        values: {},
                        successNotification: (res) => {
                          const out = res?.data;
                          return {
                            message: `对账完成：released=${out?.released ?? 0} stale_nodes=${out?.stale_nodes ?? 0}`,
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
                    {reconciling ? "对账中…" : "对账"}
                  </Button>
                )}
              </div>
            }
          />
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
      <PageBody loading={isLoading}>
        {logs.length === 0 ? (
          <Empty text="暂无审计记录。" />
        ) : (
          <Table data-testid="audit-table">
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>资源</TableHead>
                <TableHead>操作者</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{fmtTime(l.created_at)}</TableCell>
                  <TableCell>
                    <Hint label={l.action} className="font-mono">
                      <span className="cursor-default">{actionLabel(l.action)}</span>
                    </Hint>
                  </TableCell>
                  <TableCell className="mono font-mono text-xs">
                    <Hint
                      label={l.resource_id ? `${l.resource_type}:${l.resource_id}` : l.resource_type}
                      className="font-mono"
                    >
                      <span className="cursor-default">{resourceLabel(l.resource_type, l.resource_id)}</span>
                    </Hint>
                  </TableCell>
                  <TableCell className="mono font-mono text-xs">
                    <Hint label={l.actor_user_id} className="font-mono">
                      <span className="cursor-default">{shortId(l.actor_user_id)}</span>
                    </Hint>
                  </TableCell>
                  <TableCell className="mono font-mono text-xs">{l.ip || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
    </PageFrame>
  );
}

export function AuditPage() {
  return (
    <CanAccess resource="audit-logs" action="list" fallback={<Forbidden />}>
      <AuditList />
    </CanAccess>
  );
}
