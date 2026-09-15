import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Play, Square, Terminal, Trash2, X, Cpu, Globe, Lock, Clock, Box, Ban } from "lucide-react";
import { api, friendlyError } from "@/providers";
import { formatTime } from "@/ui/format";
import { canSSH } from "@/lib/permissions";
import {
  formatPlanSpec,
  hasPendingResize,
  pendingSpec,
  isDestroyPending,
  isDestroyPendingPlatform,
  isDestroyRequested,
  isWorkspaceConnectable,
  statusLabel,
  workspaceStatusVariant,
  workspaceStatusDotClass,
  workspaceStatusInFlight,
  Workspace,
  workspaceSpec,
  isK8sRuntime,
  runtimeLabel,
} from "./types";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/ui/tooltip";
import { ListCard, ListCardActions, ListCardHeader, ListCardMeta } from "@/components/ui/responsive-list";
import { ResizeDialog } from "./ResizeDialog";
import { WorkspaceTerminalDialog } from "./WorkspaceTerminalDialog";
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
import { cn } from "@/lib/utils";

type Props = {
  ws: Workspace;
  busyId: string | null;
  canApprove: boolean;
  platformRole?: string;
  myRole?: string;
  mySshAccess?: string;
  projectId?: string;
  opsLocked?: boolean;
  onBusy: (id: string | null) => void;
  onRefresh: () => void | Promise<unknown>;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
  /** 窄屏卡片；桌面表格行不要传。 */
  asCard?: boolean;
};

export function WorkspaceRow({
  ws,
  busyId,
  canApprove,
  platformRole,
  myRole,
  mySshAccess,
  opsLocked,
  onBusy,
  onRefresh,
  onToast,
  onError,
  asCard = false,
}: Props) {
  const [destroyOpen, setDestroyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [destroyRejectOpen, setDestroyRejectOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const busy = busyId === ws.id || pendingAction !== null;
  const actionDisabled = busy || Boolean(opsLocked);
  const isCreateRequested = ws.status === "requested";
  const destroyPending = isDestroyPending(ws);
  const destroyRequested = isDestroyRequested(ws);
  const destroyAwaitPlatform = isDestroyPendingPlatform(ws);
  const isPlatformAdmin = platformRole === "platform_admin";
  const destroyNow = isPlatformAdmin;
  const skipProjectReview = Boolean(canApprove) && !destroyNow;
  const displayStatus = optimisticStatus ?? (pendingAction === "destroy" && destroyNow ? "destroying" : ws.status);
  const statusBusy = workspaceStatusInFlight(displayStatus) || pendingAction === "destroy" || pendingAction === "destroy-force";
  const canStart =
    displayStatus !== "destroying" &&
    (ws.status === "stopped" || ws.status === "fabric_degraded" || ws.status === "suspended");
  const canStop =
    displayStatus !== "destroying" && (ws.status === "running" || ws.status === "fabric_degraded");
  const canRequestDestroy =
    !destroyPending &&
    ws.status !== "destroyed" &&
    ws.status !== "destroying" &&
    ws.status !== "requested";
  const wsConnectable = isWorkspaceConnectable(ws.status) && displayStatus !== "destroying";
  const sshGranted = canSSH(myRole, mySshAccess, platformRole);
  const k8s = isK8sRuntime(ws.runtime);
  const showSSH = wsConnectable && sshGranted && !k8s;
  const spec = workspaceSpec(ws);
  const pendingResize = pendingSpec(ws);
  const resizePending = hasPendingResize(ws);
  const canResize =
    !isCreateRequested &&
    !resizePending &&
    displayStatus !== "destroying" &&
    (ws.status === "running" || ws.status === "stopped" || ws.status === "fabric_degraded" || ws.status === "suspended");

  useEffect(() => {
    if (!optimisticStatus) return;
    if (ws.status === optimisticStatus || ws.status === "destroyed" || ws.status === "destroying") {
      setOptimisticStatus(null);
    }
  }, [ws.status, optimisticStatus]);

  async function run(action: () => Promise<void>, kind = "work") {
    if (
      opsLocked &&
      kind !== "destroy" &&
      kind !== "destroy-force" &&
      kind !== "destroy-approve" &&
      kind !== "destroy-reject" &&
      kind !== "cancel-request" &&
      kind !== "reject"
    ) {
      onError("请先填写项目用途，才能继续操作");
      return;
    }
    setPendingAction(kind);
    if ((kind === "destroy" && destroyNow) || kind === "destroy-force") {
      setOptimisticStatus("destroying");
    }
    onBusy(ws.id);
    onError("");
    try {
      await action();
      await onRefresh();
    } catch (e) {
      setOptimisticStatus(null);
      onError(friendlyError(e));
    } finally {
      setPendingAction(null);
      onBusy(null);
    }
  }

  function closeDialogUnlessBusy(open: boolean) {
    if (!open && pendingAction) return;
    setDestroyOpen(open);
  }

  const rowTone =
    ws.status === "failed" || displayStatus === "destroying" ? "bg-rose-500/5 hover:bg-rose-500/10" : undefined;
  const rowBusy = (busy || statusBusy) && "opacity-90";

  const statusDot = (
    <span
      className={cn(
        "size-2 rounded-full shrink-0 transition-all",
        workspaceStatusDotClass(displayStatus),
        statusBusy && "animate-pulse",
      )}
    />
  );

  const visibilityIcon =
    ws.visibility === "private" ? (
      <Hint label="私有">
        <Lock className="size-3 text-amber-500/80 shrink-0" />
      </Hint>
    ) : (
      <Hint label="共享">
        <Globe className="size-3 text-primary/70 shrink-0" />
      </Hint>
    );

  const statusBadge = (
    <Hint
      label={
        destroyPending
          ? `${displayStatus} · 终审前机器仍可进入操作`
          : `原始代码: ${displayStatus}`
      }
      className="font-mono"
    >
      <span className="inline-flex">
        <Badge variant={workspaceStatusVariant(displayStatus)} className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
          {statusBusy && <Loader2 className="size-3 shrink-0 animate-spin" />}
          {statusLabel(displayStatus)}
        </Badge>
      </span>
    </Hint>
  );

  const extraStatus = (
    <>
      {resizePending && (
        <Badge variant="warn" data-testid="ws-resize-pending" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
          <Clock className="size-3 text-amber-500 shrink-0" />
          {ws.resize_kind === "downgrade" ? "降配待审" : "升配待审"}
        </Badge>
      )}
      {typeof ws.exec_ready === "boolean" && (
        <Hint label={ws.exec_error || (ws.exec_ready ? "HTTP 执行可用" : "SSH handshake 失败")} className="font-mono">
          <Badge
            data-testid="ws-exec-ready"
            variant={ws.exec_ready ? "ok" : "danger"}
            className="inline-flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Terminal className="size-3 shrink-0" />
            {ws.exec_ready ? "SSH 通" : "SSH 不通"}
          </Badge>
        </Hint>
      )}
    </>
  );

  const specLine = (
    <span className={cn("inline-flex items-center gap-1.5 text-xs min-w-0", asCard && "max-w-full flex-wrap")}>
      <Cpu className="size-3 text-muted-foreground opacity-70 shrink-0" />
      <span className="font-medium text-foreground">{ws.plan}</span>
      {spec && (
        <span className="text-muted-foreground truncate">
          ({formatPlanSpec(spec)}
          {pendingResize && (
            <>
              <span className="mx-1">→</span>
              <span className="text-amber-500">{formatPlanSpec(pendingResize)}</span>
            </>
          )}
          )
        </span>
      )}
      <span className="mono font-mono text-muted-foreground shrink-0">{ws.arch}</span>
      <Hint label={ws.runtime || "container"} className="font-mono">
        <span className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
          <Box className="size-3 shrink-0 opacity-70" />
          {runtimeLabel(ws.runtime)}
        </span>
      </Hint>
    </span>
  );

  const opsBtn =
    "inline-flex h-7 w-full items-center justify-center gap-1 whitespace-nowrap text-xs shrink-0";

  const actionButtons = (
        <div className={cn("grid grid-cols-2 gap-1.5", asCard ? "w-full max-w-[176px]" : "ml-auto w-[176px]")}>
          {isCreateRequested && canApprove && (
            <Button
              type="button"
              size="compact"
              data-testid="ws-approve"
              disabled={actionDisabled}
              className={opsBtn}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/approve`, { method: "POST", body: "{}" });
                  onToast("已批准并开通隔离环境");
                })
              }
            >
              <Check className="size-3.5 shrink-0" />
              批准
            </Button>
          )}
          {isCreateRequested && canApprove && (
            <>
              <Button
                type="button"
                variant="outline"
                size="compact"
                data-testid="ws-reject"
                disabled={busy}
                className={opsBtn}
                onClick={() => setRejectOpen(true)}
              >
                <X className="size-3.5 shrink-0" />
                拒绝
              </Button>
              <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>拒绝申请</AlertDialogTitle>
                  </AlertDialogHeader>
                  <AlertDialogBody>
                    <AlertDialogDescription>拒绝「{ws.name}」的服务器申请？不会占用配额。</AlertDialogDescription>
                  </AlertDialogBody>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="reject-cancel">取消</AlertDialogCancel>
                    <AlertDialogAction
                      data-testid="reject-ok"
                      onClick={() => {
                        setRejectOpen(false);
                        void run(async () => {
                          await api(`/workspaces/${ws.id}/reject`, {
                            method: "POST",
                            body: JSON.stringify({ reason: "rejected" }),
                          });
                          onToast("已拒绝申请");
                        }, "reject");
                      }}
                    >
                      确定拒绝
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {resizePending && canApprove && (
            <Button
              type="button"
              size="compact"
                data-testid="ws-resize-approve"
              disabled={actionDisabled}
              className={opsBtn}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/resize/approve`, { method: "POST", body: "{}" });
                  onToast("已批准扩容");
                })
              }
            >
              <Check className="size-3.5 shrink-0" />
              批准
            </Button>
          )}
          {resizePending && (
            <Button
              type="button"
              variant="outline"
              size="compact"
              data-testid="ws-resize-reject"
              disabled={busy}
              className={opsBtn}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/resize/reject`, {
                    method: "POST",
                    body: JSON.stringify({ reason: "rejected" }),
                  });
                  onToast("已拒绝扩容申请");
                }, "reject")
              }
            >
              <X className="size-3.5 shrink-0" />
              {canApprove ? "拒绝" : "撤销"}
            </Button>
          )}
          {canResize && (
            <ResizeDialog
              ws={ws}
              disabled={actionDisabled}
              canApprove={canApprove}
              onSubmitted={(applied) => {
                onToast(applied ? "已完成升配" : "已提交申请，等待管理员审批");
                onRefresh();
              }}
              onError={onError}
            />
          )}
          {canStart && (
            <Button
              type="button"
              size="compact"
              data-testid="ws-start"
              disabled={actionDisabled}
              loading={pendingAction === "start"}
              className={opsBtn}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/start`, { method: "POST" });
                  onToast("已启动");
                }, "start")
              }
            >
              <Play className="size-3.5 shrink-0 text-emerald-500" />
              启动
            </Button>
          )}
          {canStop && (
            <Button
              type="button"
              size="compact"
              data-testid="ws-stop"
              disabled={actionDisabled}
              loading={pendingAction === "stop"}
              className={opsBtn}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/stop`, { method: "POST" });
                  onToast("已停止（仍占配额）：销毁后才会释放资源");
                }, "stop")
              }
            >
              <Square className="size-3.5 shrink-0 text-amber-500" />
              停止
            </Button>
          )}
          {isCreateRequested && (
            <>
              <Button
                type="button"
                variant="destructive"
                size="compact"
                data-testid="ws-cancel-request"
                disabled={busy}
                className={opsBtn}
                onClick={() => setDestroyOpen(true)}
              >
                <X className="size-3.5 shrink-0" />
                撤销
              </Button>
              <AlertDialog open={destroyOpen} onOpenChange={closeDialogUnlessBusy}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>撤销开通申请</AlertDialogTitle>
                  </AlertDialogHeader>
                  <AlertDialogBody>
                    <AlertDialogDescription>确认撤销「{ws.name}」的开通申请？不会占用配额。</AlertDialogDescription>
                  </AlertDialogBody>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="confirm-cancel" disabled={busy}>取消</AlertDialogCancel>
                    <AlertDialogAction
                      data-testid="confirm-ok"
                      loading={pendingAction === "cancel-request"}
                      onClick={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          await api(`/workspaces/${ws.id}/reject`, {
                            method: "POST",
                            body: JSON.stringify({ reason: "cancelled" }),
                          });
                          onToast("已撤销申请");
                          setDestroyOpen(false);
                        }, "cancel-request");
                      }}
                    >
                      确定撤销
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {destroyRequested && canApprove && (
            <>
              <Button
                type="button"
                variant="outline"
                size="compact"
                data-testid="ws-destroy-reject-project"
                disabled={busy}
                loading={pendingAction === "destroy-reject"}
                className={opsBtn}
                onClick={() => setDestroyRejectOpen(true)}
              >
                <Ban className="size-3.5 shrink-0" />
                驳回
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="compact"
                data-testid="ws-destroy-approve-project"
                disabled={busy}
                loading={pendingAction === "destroy-approve"}
                className={opsBtn}
                onClick={() =>
                  run(async () => {
                    await api(`/workspaces/${ws.id}/destroy-request/approve`, { method: "POST", body: "{}" });
                    onToast("已通过项目初审，等待平台终审");
                  }, "destroy-approve")
                }
              >
                <Trash2 className="size-3.5 shrink-0" />
                初审
              </Button>
            </>
          )}
          {canRequestDestroy && displayStatus !== "destroying" && (
            <Button
              type="button"
              variant="destructive"
              size="compact"
              data-testid="ws-destroy"
              disabled={busy}
              loading={pendingAction === "destroy"}
              className={opsBtn}
              onClick={() => setDestroyOpen(true)}
            >
              <Trash2 className="size-3.5 shrink-0" />
              销毁
            </Button>
          )}
          {(canRequestDestroy || destroyOpen) && (
              <AlertDialog open={destroyOpen} onOpenChange={closeDialogUnlessBusy}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{destroyNow || skipProjectReview ? "销毁服务器" : "申请销毁服务器"}</AlertDialogTitle>
                  </AlertDialogHeader>
                  <AlertDialogBody>
                    <AlertDialogDescription>
                      {destroyNow
                        ? "你已是平台管理员，确认后将立即销毁，无需再走申请与审核。配额立刻归还，隔离环境不可恢复。"
                        : skipProjectReview
                          ? "你已是项目管理员，确认后直接提交平台终审，无需再申请项目初审。通过后配额归还，隔离环境不可恢复。"
                          : "提交后需项目管理员初审，再由平台超级管理员终审。通过后配额归还，隔离环境不可恢复。"}
                    </AlertDialogDescription>
                  </AlertDialogBody>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="confirm-cancel" disabled={busy}>取消</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      data-testid="confirm-ok"
                      loading={pendingAction === "destroy"}
                      onClick={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          const out = await api<{ status?: string }>(`/workspaces/${ws.id}/destroy-request`, { method: "POST", body: "{}" });
                          if (out?.status === "destroyed" || out?.status === "destroying") {
                            onToast("已销毁");
                          } else if (out?.status === "destroy_pending_platform") {
                            onToast("已提交平台终审");
                          } else {
                            onToast("已提交销毁申请");
                          }
                          setDestroyOpen(false);
                        }, "destroy");
                      }}
                    >
                      {destroyNow ? "确认销毁" : skipProjectReview ? "提交平台终审" : "提交申请"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
          )}
          <AlertDialog
            open={destroyRejectOpen}
            onOpenChange={(open) => {
              if (!open && pendingAction) return;
              setDestroyRejectOpen(open);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{destroyAwaitPlatform ? "驳回平台终审" : "驳回销毁申请"}</AlertDialogTitle>
              </AlertDialogHeader>
              <AlertDialogBody>
                <AlertDialogDescription>
                  驳回后工作区「{ws.name}」将保留，不会销毁。
                </AlertDialogDescription>
              </AlertDialogBody>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="ws-destroy-reject-cancel" disabled={busy}>取消</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="ws-destroy-reject-ok"
                  loading={pendingAction === "destroy-reject"}
                  onClick={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      if (destroyAwaitPlatform) {
                        await api(`/admin/dangerous-approvals/${ws.id}/reject`, {
                          method: "POST",
                          body: JSON.stringify({ reason: "rejected" }),
                        });
                        onToast("已驳回终审，工作区已保留");
                      } else {
                        await api(`/workspaces/${ws.id}/destroy-request/reject`, {
                          method: "POST",
                          body: JSON.stringify({ reason: "rejected" }),
                        });
                        onToast("已驳回销毁申请");
                      }
                      setDestroyRejectOpen(false);
                    }, "destroy-reject");
                  }}
                >
                  确定驳回
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {displayStatus === "destroying" && !destroyOpen && (
            <span className="inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 whitespace-nowrap shrink-0">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              正在销毁
            </span>
          )}
          {destroyAwaitPlatform && isPlatformAdmin && displayStatus !== "destroying" && (
            <>
              <Button
                type="button"
                variant="outline"
                size="compact"
                data-testid="ws-destroy-reject-platform"
                disabled={busy}
                loading={pendingAction === "destroy-reject"}
                className={opsBtn}
                onClick={() => setDestroyRejectOpen(true)}
              >
                <Ban className="size-3.5 shrink-0" />
                驳回
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="compact"
                data-testid="ws-destroy-force"
                disabled={busy}
                loading={pendingAction === "destroy-force"}
                className={opsBtn}
                onClick={() =>
                  run(async () => {
                    await api(`/admin/dangerous-approvals/${ws.id}/approve`, { method: "POST", body: "{}" });
                    onToast("平台终审通过，已销毁");
                  }, "destroy-force")
                }
              >
                <Trash2 className="size-3.5 shrink-0" />
                终审
              </Button>
            </>
          )}
          {showSSH && (
            <>
              <Button
                type="button"
                size="compact"
                data-testid="ws-web-terminal"
                disabled={actionDisabled}
                className={opsBtn}
                onClick={() => {
                  if (opsLocked) {
                    onError("请先填写项目用途，才能继续操作");
                    return;
                  }
                  setTermOpen(true);
                }}
              >
                <Terminal className="size-3.5 shrink-0" />
                终端
              </Button>
              <WorkspaceTerminalDialog
                workspaceId={ws.id}
                workspaceName={ws.name}
                open={termOpen}
                onOpenChange={setTermOpen}
              />
            </>
          )}
        </div>
  );

  if (asCard) {
    return (
      <ListCard
        data-testid="ws-row"
        data-status={displayStatus}
        aria-busy={busy || statusBusy}
        className={cn(rowTone, rowBusy)}
      >
        <ListCardHeader
          leading={statusDot}
          title={
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
              <Hint label="查看详情" className="min-w-0 truncate">
                <Link
                  data-testid="ws-manage"
                  to={`/workspaces/${ws.id}`}
                  className="truncate text-foreground hover:underline"
                >
                  {ws.name}
                </Link>
              </Hint>
              {visibilityIcon}
            </span>
          }
          trailing={statusBadge}
        />
        <ListCardMeta className="text-foreground">
          {extraStatus}
          {specLine}
          {ws.node_name ? (
            <span className="inline-flex items-center gap-1 shrink-0">
              <Cpu className="size-3 opacity-60 shrink-0" />
              {ws.node_name}
            </span>
          ) : null}
          {ws.created_at ? (
            <span className="inline-flex items-center gap-1 shrink-0">
              <Clock className="size-3 opacity-60 shrink-0" />
              {formatTime(ws.created_at)}
            </span>
          ) : null}
        </ListCardMeta>
        <ListCardActions>{actionButtons}</ListCardActions>
      </ListCard>
    );
  }

  return (
    <TableRow
      data-testid="ws-row"
      data-status={displayStatus}
      aria-busy={busy || statusBusy}
      className={cn(rowTone, rowBusy)}
    >
      <TableCell className="py-2.5 whitespace-nowrap font-medium text-foreground">
        <div className="flex items-center gap-2">
          {statusDot}
          <Hint label="查看详情" className="min-w-0 max-w-[180px] sm:max-w-xs truncate">
            <Link
              data-testid="ws-manage"
              to={`/workspaces/${ws.id}`}
              className="truncate text-foreground hover:underline"
            >
              {ws.name}
            </Link>
          </Hint>
          {visibilityIcon}
        </div>
      </TableCell>
      <TableCell className="py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          {statusBadge}
          {extraStatus}
        </div>
      </TableCell>
      <TableCell className="py-2.5 whitespace-nowrap">{specLine}</TableCell>
      <TableCell className="py-2.5 whitespace-nowrap text-xs">
        {ws.node_name ? (
          <span className="font-medium text-foreground">{ws.node_name}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-2.5 whitespace-nowrap text-xs text-muted-foreground">
        {ws.created_at ? formatTime(ws.created_at) : "—"}
      </TableCell>
      <TableCell stickyEnd className="py-2.5 text-right w-[200px] pr-4">
        {actionButtons}
      </TableCell>
    </TableRow>
  );
}
