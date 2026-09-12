import { useCallback, useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, RefreshCw, Server, ShieldAlert, SlidersHorizontal, Trash2 } from "lucide-react";
import { api, friendlyError, type AuthUser } from "@/providers";
import { canApproveDangerousOps } from "@/lib/permissions";
import { statusLabel, Workspace } from "@/pages/workspaces/types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Badge } from "@/components/ui/badge";
import { Elevated } from "@/lib/elevated";
import { Hint } from "@/components/ui/tooltip";
import { Loading } from "@/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DangerousApprovalsPage() {
  const { data: me } = useGetIdentity<AuthUser>();
  const [rows, setRows] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Workspace | null>(null);

  const allowed = canApproveDangerousOps(me?.platform_role);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setErr("");
    try {
      const json = await api<{ data: Workspace[] }>("/admin/dangerous-approvals");
      setRows(json.data ?? []);
    } catch (e) {
      setErr(friendlyError(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setErr("");
    try {
      await api(`/admin/dangerous-approvals/${id}/approve`, { method: "POST", body: "{}" });
      setConfirmTarget(null);
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!allowed) {
    return (
      <PageFrame
        header={
          <div className="flex items-center gap-3">
            <span className="size-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0 border border-destructive/20 shadow-xs">
              <ShieldAlert className="size-4.5" />
            </span>
            <div>
              <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">危险操作终审</h2>
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
            <ShieldAlert className="size-10 text-destructive" />
            <h3 className="m-0 text-base font-semibold text-foreground">无终审权限</h3>
            <p className="m-0 text-xs text-muted-foreground leading-relaxed">
              仅平台超级管理员 (platform_admin) 或受权的安全运维委派角色可对销毁等危险操作进行终审裁决。
            </p>
          </Elevated>
        </div>
      </PageFrame>
    );
  }

  return (
    <>
      <PageFrame
        header={
          <PageHeading
            icon={ShieldAlert}
            iconClassName="bg-rose-500/10 text-rose-500 border-rose-500/20"
            title="危险操作终审"
            badges={
              <Badge variant={rows.length > 0 ? "danger" : "outline"} className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal">
                {rows.length} 笔待终审
              </Badge>
            }
            description="项目管理员已初审通过的隔离工作区销毁申请。经平台超级管理员终审后，将彻底释放物理资源配额并擦除实例数据。"
            actions={
              <Button
                type="button"
                variant="outline"
                size="compact"
                onClick={() => void load()}
                disabled={loading}
                className="h-8 px-3 text-xs gap-1.5 shrink-0"
              >
                <RefreshCw className="size-3.5 opacity-70 shrink-0" />
                刷新待审
              </Button>
            }
          >

            {/* 警示条 */}
            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 shadow-surface-1 flex items-start gap-2.5 text-xs text-rose-500"
            >
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">
                高危防线注意：终审通过后将执行不可逆的容器与存储销毁指令。请核验所属项目以及该工作区是否仍有挂载资产未备份。
              </span>
            </Elevated>

            {err && (
              <Alert variant="destructive">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
          </PageHeading>
        }
      >
        {loading ? (
          <div className="py-12 text-center">
            <Loading label="加载危险待审队列…" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center">
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-md w-full flex flex-col items-center gap-3"
            >
              <div className="size-12 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center border border-emerald-500/20 shadow-xs">
                <CheckCircle2 className="size-6" />
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-foreground">当前无危险待审任务</h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  所有工作区与物理切片运行平稳，无处于平台终审阶段的销毁请求。
                </p>
              </div>
            </Elevated>
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
            <Table data-testid="dangerous-approvals-table" className="min-w-[760px]">
              <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Server className="size-3.5 opacity-60 shrink-0" />
                      工作区 / 服务器
                    </span>
                  </TableHead>
                  <TableHead className="w-[200px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <FolderKanban className="size-3.5 opacity-60 shrink-0" />
                      所属项目
                    </span>
                  </TableHead>
                  <TableHead className="w-[150px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Clock className="size-3.5 opacity-60 shrink-0" />
                      当前审批状态
                    </span>
                  </TableHead>
                  <TableHead stickyEnd className="w-[160px] text-right py-2.5 pr-4">
                    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">
                      <SlidersHorizontal className="size-3.5 opacity-60 shrink-0" />
                      终审操作
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.id} data-testid="dangerous-approval-row" className="hover:bg-rose-500/5">
                    <TableCell className="py-2.5 font-medium whitespace-nowrap text-foreground">
                      <div className="inline-flex items-center gap-2">
                        <span className="size-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)] shrink-0" />
                        <Server className="size-3.5 text-primary opacity-70 shrink-0" />
                        <span>{w.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="mono font-mono text-xs py-2.5 whitespace-nowrap text-muted-foreground">
                      <Hint label={w.project_id}>
                        <span className="cursor-help bg-muted/40 px-1.5 py-0.5 rounded border border-border/50">
                          {w.project_id.length > 12 ? `${w.project_id.slice(0, 12)}…` : w.project_id}
                        </span>
                      </Hint>
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <Badge variant="warn" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                        <Clock className="size-3 text-amber-500 shrink-0" />
                        {statusLabel(w.status)}
                      </Badge>
                    </TableCell>
                    <TableCell stickyEnd className="text-right py-2.5 w-[160px] pr-4">
                      <Button
                        type="button"
                        variant="destructive"
                        size="compact"
                        data-testid="dangerous-approve-open"
                        disabled={busyId === w.id}
                        className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs px-2.5"
                        onClick={() => setConfirmTarget(w)}
                      >
                        <Trash2 className="size-3.5 shrink-0" />
                        平台终审销毁
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageFrame>

      <AlertDialog open={!!confirmTarget} onOpenChange={(v) => !v && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认平台终审并销毁</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              确认批准终审并彻底销毁工作区「{confirmTarget?.name}」？此操作将彻底删除隔离容器并归还物理机账本硬占用配额，数据不可恢复。
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="dangerous-cancel">取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="dangerous-confirm"
              variant="destructive"
              onClick={() => confirmTarget && void approve(confirmTarget.id)}
            >
              确定终审销毁
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
