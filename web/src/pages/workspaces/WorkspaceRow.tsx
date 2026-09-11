import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Download, KeyRound, Loader2, Play, Square, Terminal, Trash2, X, Cpu, Globe, Lock, Clock } from "lucide-react";
import { api, apiText, friendlyError } from "@/providers";
import { formatTime, copyText } from "@/ui/format";
import { canSSH } from "@/lib/permissions";
import {
  formatPlanSpec,
  hasPendingResize,
  pendingSpec,
  isDestroyPending,
  isDestroyPendingPlatform,
  isDestroyRequested,
  statusLabel,
  workspaceStatusVariant,
  workspaceStatusDotClass,
  workspaceStatusInFlight,
  Workspace,
  workspaceSpec,
} from "./types";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/ui/tooltip";
import { ImportKeyDialog } from "./ImportKeyDialog";
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
  onBusy: (id: string | null) => void;
  onRefresh: () => void | Promise<unknown>;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
};

async function downloadSSHConfig(id: string): Promise<void> {
  const text = await apiText(`/workspaces/${id}/ssh-config`);
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ha-${id.slice(0, 8)}.config`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function WorkspaceRow({
  ws,
  busyId,
  canApprove,
  platformRole,
  myRole,
  mySshAccess,
  projectId,
  onBusy,
  onRefresh,
  onToast,
  onError,
}: Props) {
  const [destroyOpen, setDestroyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [copiedSsh, setCopiedSsh] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [manualSsh, setManualSsh] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const busy = busyId === ws.id || pendingAction !== null;
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
  const wsRunning = ws.status === "running" || ws.status === "fabric_degraded" || ws.status === "suspended";
  const sshGranted = canSSH(myRole, mySshAccess, platformRole);
  const showSSH = wsRunning && sshGranted && displayStatus !== "destroying";
  const showSSHRequest = wsRunning && !sshGranted && myRole === "developer" && displayStatus !== "destroying";
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

  return (
    <TableRow
      data-testid="ws-row"
      data-status={displayStatus}
      aria-busy={busy || statusBusy}
      className={cn(
        ws.status === "failed" || displayStatus === "destroying" ? "bg-rose-500/5 hover:bg-rose-500/10" : undefined,
        (busy || statusBusy) && "opacity-90",
      )}
    >
      <TableCell className="py-2.5 whitespace-nowrap font-medium text-foreground">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full shrink-0 transition-all",
              workspaceStatusDotClass(displayStatus),
              statusBusy && "animate-pulse",
            )}
          />
          <span className="truncate max-w-[180px] sm:max-w-xs">{ws.name}</span>
          {ws.visibility === "private" ? (
            <Hint label="私有">
              <Lock className="size-3 text-amber-500/80 shrink-0" />
            </Hint>
          ) : (
            <Hint label="共享">
              <Globe className="size-3 text-primary/70 shrink-0" />
            </Hint>
          )}
        </div>
      </TableCell>
      <TableCell className="py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <Hint label={`原始代码: ${displayStatus}`} className="font-mono">
            <span className="inline-flex">
              <Badge variant={workspaceStatusVariant(displayStatus)} className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                {statusBusy && <Loader2 className="size-3 shrink-0 animate-spin" />}
                {statusLabel(displayStatus)}
              </Badge>
            </span>
          </Hint>
          {resizePending && (
            <Badge variant="warn" data-testid="ws-resize-pending" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
              <Clock className="size-3 text-amber-500 shrink-0" />
              {ws.resize_kind === "downgrade" ? "降配待审" : "升配待审"}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="py-2.5 whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5 text-xs">
          <Cpu className="size-3 text-muted-foreground opacity-70 shrink-0" />
          <span className="font-medium text-foreground">{ws.plan}</span>
          {spec && (
            <span className="text-muted-foreground">
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
          <span className="mono font-mono text-muted-foreground">{ws.arch}</span>
        </div>
      </TableCell>
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
      <TableCell stickyEnd className="py-2.5 text-right w-[320px] pr-4">
        <div className="flex items-center justify-end flex-wrap gap-1 whitespace-nowrap">
          {isCreateRequested && canApprove && (
            <Button
              type="button"
              size="compact"
              data-testid="ws-approve"
              disabled={busy}
              className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/approve`, { method: "POST", body: "{}" });
                  onToast("已批准并开通隔离环境");
                })
              }
            >
              <Check className="size-3.5 shrink-0" />
              批准开通
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
                className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
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
                        });
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
              disabled={busy}
              className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/resize/approve`, { method: "POST", body: "{}" });
                  onToast("已批准扩容");
                })
              }
            >
              <Check className="size-3.5 shrink-0" />
              批准扩容
            </Button>
          )}
          {resizePending && (
            <Button
              type="button"
              variant="outline"
              size="compact"
              data-testid="ws-resize-reject"
              disabled={busy}
              className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/resize/reject`, {
                    method: "POST",
                    body: JSON.stringify({ reason: "rejected" }),
                  });
                  onToast("已拒绝扩容申请");
                })
              }
            >
              <X className="size-3.5 shrink-0" />
              {canApprove ? "拒绝扩容" : "撤销扩容"}
            </Button>
          )}
          {canResize && (
            <ResizeDialog
              ws={ws}
              disabled={busy}
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
              variant="ghost"
              size="compact"
              data-testid="ws-start"
              disabled={busy}
              loading={pendingAction === "start"}
              className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
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
              variant="ghost"
              size="compact"
              data-testid="ws-stop"
              disabled={busy}
              loading={pendingAction === "stop"}
              className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
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
                className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
                onClick={() => setDestroyOpen(true)}
              >
                <X className="size-3.5 shrink-0" />
                撤销申请
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
            <Button
              type="button"
              variant="destructive"
              size="compact"
              data-testid="ws-destroy-approve-project"
              disabled={busy}
              loading={pendingAction === "destroy-approve"}
              className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/destroy-request/approve`, { method: "POST", body: "{}" });
                  onToast("已通过项目初审，等待平台终审");
                }, "destroy-approve")
              }
            >
              <Trash2 className="size-3.5 shrink-0" />
              销毁初审
            </Button>
          )}
          {canRequestDestroy && displayStatus !== "destroying" && (
            <Button
              type="button"
              variant="destructive"
              size="compact"
              data-testid="ws-destroy"
              disabled={busy}
              loading={pendingAction === "destroy"}
              className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
              onClick={() => setDestroyOpen(true)}
            >
              <Trash2 className="size-3.5 shrink-0" />
              {destroyNow ? "销毁" : skipProjectReview ? "销毁" : "申请销毁"}
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
          {displayStatus === "destroying" && !destroyOpen && (
            <span className="inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 whitespace-nowrap shrink-0">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              正在销毁
            </span>
          )}
          {destroyAwaitPlatform && isPlatformAdmin && displayStatus !== "destroying" && (
            <Button
              type="button"
              variant="destructive"
              size="compact"
              data-testid="ws-destroy-force"
              disabled={busy}
              loading={pendingAction === "destroy-force"}
              className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
              onClick={() =>
                run(async () => {
                  await api(`/admin/dangerous-approvals/${ws.id}/approve`, { method: "POST", body: "{}" });
                  onToast("平台终审通过，已销毁");
                }, "destroy-force")
              }
            >
              <Trash2 className="size-3.5 shrink-0" />
              平台终审
            </Button>
          )}
          {showSSHRequest && projectId && (
            <Button variant="outline" size="compact" asChild className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs">
              <Link data-testid="ws-request-ssh" to={`/projects/${projectId}/members`}>
                <Terminal className="size-3.5 shrink-0" />
                申请 SSH
              </Link>
            </Button>
          )}
          {showSSH && (
            <>
              <Button
                type="button"
                size="compact"
                data-testid="ws-web-terminal"
                className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
                onClick={() => setTermOpen(true)}
              >
                <Terminal className="size-3.5 shrink-0" />
                打开终端
              </Button>
              <WorkspaceTerminalDialog
                workspaceId={ws.id}
                workspaceName={ws.name}
                open={termOpen}
                onOpenChange={setTermOpen}
              />
              <Button variant="outline" size="compact" asChild className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs">
                <Link data-testid="ws-manage" to={`/workspaces/${ws.id}`}>
                  连接 / 详情
                </Link>
              </Button>
              <Hint label="复制 SSH 一键连接命令">
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  data-testid="ws-copy-ssh"
                  disabled={busy}
                  className={cn(
                    "inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 px-2 text-xs",
                    copiedSsh && "text-emerald-500 font-medium"
                  )}
                  onClick={() =>
                    run(async () => {
                      const info = await api<{ command: string }>(`/workspaces/${ws.id}/connection`);
                      const ok = await copyText(info.command);
                      if (ok) {
                        setCopiedSsh(true);
                        setTimeout(() => setCopiedSsh(false), 2000);
                        onToast("已复制 SSH 连接命令");
                        return;
                      }
                      setManualSsh(info.command);
                    })
                  }
                >
                  {copiedSsh ? <Check className="size-3.5 text-emerald-500 shrink-0" /> : <Copy className="size-3.5 opacity-70 shrink-0" />}
                  {copiedSsh ? "已复制" : "复制命令"}
                </Button>
              </Hint>
              <Hint label="下载标准 SSH config 配置文件">
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  data-testid="ws-ssh-download"
                  disabled={busy}
                  className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 px-2 text-xs"
                  onClick={() =>
                    run(async () => {
                      await downloadSSHConfig(ws.id);
                      onToast("SSH config 已下载（含 Host / RemoteCommand）");
                    })
                  }
                >
                  <Download className="size-3.5 opacity-70 shrink-0" />
                  配置
                </Button>
              </Hint>
              <ImportKeyDialog
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    data-testid="ws-import-key"
                    className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 px-2 text-xs"
                  >
                    <KeyRound className="size-3.5 opacity-70 shrink-0" />
                    导公钥
                  </Button>
                }
                onImported={() => {
                  onToast("公钥已导入");
                  onRefresh();
                }}
              />
              <AlertDialog open={Boolean(manualSsh)} onOpenChange={(open) => { if (!open) setManualSsh(""); }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>手动复制 SSH 命令</AlertDialogTitle>
                    <AlertDialogDescription>
                      当前页面不是 HTTPS，浏览器不允许直接写入剪贴板。点选下方命令复制，或再点一次「复制」。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogBody>
                    <textarea
                      readOnly
                      autoFocus
                      data-testid="ws-copy-ssh-fallback"
                      className="w-full min-h-20 rounded-md border border-(--line-strong) bg-(--input-bg) p-2 font-mono text-xs"
                      value={manualSsh}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </AlertDialogBody>
                  <AlertDialogFooter>
                    <AlertDialogCancel>关闭</AlertDialogCancel>
                    <Button
                      type="button"
                      data-testid="ws-copy-ssh-fallback-confirm"
                      onClick={() => {
                        void (async () => {
                          const ok = await copyText(manualSsh);
                          if (!ok) return;
                          setCopiedSsh(true);
                          setTimeout(() => setCopiedSsh(false), 2000);
                          onToast("已复制 SSH 连接命令");
                          setManualSsh("");
                        })();
                      }}
                    >
                      复制
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
