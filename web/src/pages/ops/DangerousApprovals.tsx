import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useGetIdentity } from "@refinedev/core";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FolderKanban,
  RefreshCw,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import { api, friendlyError, type AuthUser } from "@/providers";
import { canApproveDangerousOps } from "@/lib/permissions";
import { statusLabel, type DangerousDestroyItem } from "@/pages/workspaces/types";
import { destroyApplicantLabel, destroyProjectLabel } from "@/pages/ops/format";
import { formatTime } from "@/ui/format";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListCard, ListCardActions, ListCardHeader, ListCardMeta, ResponsiveList } from "@/components/ui/responsive-list";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Badge } from "@/components/ui/badge";
import { Elevated } from "@/lib/elevated";
import { Hint } from "@/components/ui/tooltip";
import { Loading } from "@/ui";
import { useIsMd } from "@/hooks/use-media-query";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

type ConfirmKind = "approve" | "reject";

export function DangerousApprovalsPage() {
  const { data: me } = useGetIdentity<AuthUser>();
  const [rows, setRows] = useState<DangerousDestroyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: DangerousDestroyItem; kind: ConfirmKind } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const allowed = canApproveDangerousOps(me?.platform_role);
  const isMd = useIsMd();

  const warnBar = (
            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 shadow-surface-1 flex items-start gap-2.5 text-xs text-rose-500"
            >
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">
                高危防线注意：终审通过后将执行不可逆的容器与存储销毁指令。请核验所属项目、申请人以及该工作区是否仍有挂载资产未备份。不同意销毁请点驳回，实例会保留。
              </span>
            </Elevated>
  );

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setErr("");
    try {
      const json = await api<{ data: DangerousDestroyItem[] }>("/admin/dangerous-approvals");
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

  function closeConfirm() {
    setConfirm(null);
    setRejectReason("");
  }

  async function approve(id: string) {
    setBusyId(id);
    setErr("");
    try {
      await api(`/admin/dangerous-approvals/${id}/approve`, { method: "POST", body: "{}" });
      closeConfirm();
      toast.success("终审通过，工作区已销毁");
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    setErr("");
    try {
      await api(`/admin/dangerous-approvals/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      closeConfirm();
      toast.success("已驳回销毁申请，工作区已保留");
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

  const confirmProject = confirm ? destroyProjectLabel(confirm.row) : "";
  const confirmApplicant = confirm ? destroyApplicantLabel(confirm.row) : "";

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
            description="项目管理员已初审通过的隔离工作区销毁申请。请核验项目与申请人后，选择通过销毁或驳回保留。"
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

            {isMd ? warnBar : null}

            {err && (
              <Alert variant="destructive">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
          </PageHeading>
        }
      >
        {!isMd ? <div className="mb-3">{warnBar}</div> : null}
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
          <ResponsiveList
            table={
          <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
            <Table data-testid="dangerous-approvals-table" stackOnMobile={false} className="min-w-[1080px]">
              <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs border-b border-border/70 select-none">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Server className="size-3.5 opacity-60 shrink-0" />
                      工作区 / 服务器
                    </span>
                  </TableHead>
                  <TableHead className="w-[220px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <FolderKanban className="size-3.5 opacity-60 shrink-0" />
                      所属项目
                    </span>
                  </TableHead>
                  <TableHead className="w-[180px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <UserRound className="size-3.5 opacity-60 shrink-0" />
                      申请人
                    </span>
                  </TableHead>
                  <TableHead className="w-[140px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Clock className="size-3.5 opacity-60 shrink-0" />
                      当前审批状态
                    </span>
                  </TableHead>
                  <TableHead stickyEnd className="w-[220px] text-right py-2.5 pr-4">
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
                    <TableCell className="py-2.5">
                      <ProjectCell item={w} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <ApplicantCell item={w} />
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <Hint label={w.status} className="font-mono">
                        <Badge variant="warn" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                          <Clock className="size-3 text-amber-500 shrink-0" />
                          {statusLabel(w.status)}
                        </Badge>
                      </Hint>
                    </TableCell>
                    <TableCell stickyEnd className="text-right py-2.5 w-[220px] pr-4">
                      <QueueActions
                        busy={busyId === w.id}
                        onReject={() => setConfirm({ row: w, kind: "reject" })}
                        onApprove={() => setConfirm({ row: w, kind: "approve" })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
            }
            cards={rows.map((w) => (
              <ListCard key={w.id} data-testid="dangerous-approval-row" className="hover:bg-rose-500/5">
                <ListCardHeader
                  leading={<span className="size-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)] shrink-0" />}
                  title={w.name}
                  trailing={
                    <Hint label={w.status} className="font-mono">
                      <Badge variant="warn" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                        <Clock className="size-3 text-amber-500 shrink-0" />
                        {statusLabel(w.status)}
                      </Badge>
                    </Hint>
                  }
                />
                <ListCardMeta>
                  <ProjectCell item={w} />
                  <ApplicantCell item={w} />
                </ListCardMeta>
                <ListCardActions>
                  <QueueActions
                    busy={busyId === w.id}
                    onReject={() => setConfirm({ row: w, kind: "reject" })}
                    onApprove={() => setConfirm({ row: w, kind: "approve" })}
                  />
                </ListCardActions>
              </ListCard>
            ))}
          />
        )}
      </PageFrame>

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && closeConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "reject" ? "驳回销毁终审" : "确认平台终审并销毁"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {confirm?.kind === "reject" ? (
                <>
                  驳回后工作区「{confirm.row.name}」将保留，不会销毁。所属项目「{confirmProject}」，申请人 {confirmApplicant}。
                </>
              ) : (
                <>
                  确认批准终审并彻底销毁工作区「{confirm?.row.name}」？所属项目「{confirmProject}」，申请人 {confirmApplicant}。此操作将删除隔离容器并归还配额，数据不可恢复。
                </>
              )}
            </AlertDialogDescription>
            {confirm?.kind === "reject" ? (
              <div className="mt-3 flex flex-col gap-1.5 min-w-0">
                <Label htmlFor="dangerous-reject-reason">驳回原因（可选）</Label>
                <Textarea
                  id="dangerous-reject-reason"
                  data-testid="dangerous-reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="例如：项目仍在使用，或备份尚未完成"
                  className="min-h-[72px] break-words"
                />
              </div>
            ) : null}
          </AlertDialogBody>
          <AlertDialogFooter>
            {confirm?.kind === "reject" ? (
              <>
                <AlertDialogCancel data-testid="dangerous-reject-cancel">取消</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="dangerous-reject-confirm"
                  onClick={() => confirm && void reject(confirm.row.id)}
                >
                  确定驳回
                </AlertDialogAction>
              </>
            ) : (
              <>
                <AlertDialogCancel data-testid="dangerous-cancel">取消</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="dangerous-confirm"
                  variant="destructive"
                  onClick={() => confirm && void approve(confirm.row.id)}
                >
                  确定终审销毁
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProjectCell({ item }: { item: DangerousDestroyItem }) {
  const name = destroyProjectLabel(item);
  const hint = [item.project_slug, item.project_id].filter(Boolean).join(" · ");
  return (
    <Hint label={hint || item.project_id}>
      <Link
        to={`/projects/${item.project_id}`}
        className="inline-flex items-center gap-1.5 min-w-0 max-w-[220px] text-foreground hover:underline"
      >
        <FolderKanban className="size-3.5 opacity-60 shrink-0" />
        <span className="truncate">{name}</span>
      </Link>
    </Hint>
  );
}

function ApplicantCell({ item }: { item: DangerousDestroyItem }) {
  const name = destroyApplicantLabel(item);
  const hintParts = [item.applicant_username, item.applicant_user_id].filter(
    (part) => part && part !== name,
  );
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Hint label={hintParts.join(" · ") || name} className="font-mono">
        <span className="inline-flex items-center gap-1.5 min-w-0 max-w-[180px] text-foreground">
          <UserRound className="size-3.5 opacity-60 shrink-0" />
          <span className="truncate">{name}</span>
        </span>
      </Hint>
      {item.requested_at ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
          <Clock className="size-3 opacity-60 shrink-0" />
          {formatTime(item.requested_at)}
        </span>
      ) : null}
    </div>
  );
}

function QueueActions({
  busy,
  onReject,
  onApprove,
}: {
  busy: boolean;
  onReject: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap shrink-0">
      <Button
        type="button"
        variant="outline"
        size="compact"
        data-testid="dangerous-reject-open"
        disabled={busy}
        className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs px-2.5"
        onClick={onReject}
      >
        <Ban className="size-3.5 shrink-0" />
        驳回
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="compact"
        data-testid="dangerous-approve-open"
        disabled={busy}
        className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs px-2.5"
        onClick={onApprove}
      >
        <Trash2 className="size-3.5 shrink-0" />
        通过销毁
      </Button>
    </div>
  );
}
