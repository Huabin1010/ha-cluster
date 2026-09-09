import { useState } from "react";
import { Link } from "react-router-dom";
import { api, apiText, friendlyError } from "../../providers";
import { formatPlanSpec, hasPendingResize, statusLabel, Workspace, workspaceSpec } from "./types";
import { Button } from "../../components/ui/button";
import { TableCell, TableRow } from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { Hint } from "../../components/ui/tooltip";
import { ImportKeyDialog } from "./ImportKeyDialog";
import { ResizeDialog } from "./ResizeDialog";
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
} from "../../components/ui/alert-dialog";

type Props = {
  ws: Workspace;
  busyId: string | null;
  canApprove: boolean;
  onBusy: (id: string | null) => void;
  onRefresh: () => void;
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

function badgeVariant(status: string) {
  if (status === "running") return "ok" as const;
  if (status === "fabric_degraded" || status === "requested" || status === "suspended") return "warn" as const;
  if (status === "rejected" || status === "failed") return "danger" as const;
  return "outline" as const;
}

export function WorkspaceRow({ ws, busyId, canApprove, onBusy, onRefresh, onToast, onError }: Props) {
  const [destroyOpen, setDestroyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const busy = busyId === ws.id;
  const pending = ws.status === "requested";
  const canStart = ws.status === "stopped" || ws.status === "fabric_degraded" || ws.status === "suspended";
  const canStop = ws.status === "running" || ws.status === "fabric_degraded";
  const canDestroy = ws.status !== "destroyed" && ws.status !== "destroying";
  const canSSH = ws.status === "running" || ws.status === "fabric_degraded" || ws.status === "suspended";
  const spec = workspaceSpec(ws);
  const resizePending = hasPendingResize(ws);
  const canResize = !pending && !resizePending && (ws.status === "running" || ws.status === "stopped" || ws.status === "fabric_degraded" || ws.status === "suspended");

  async function run(action: () => Promise<void>) {
    onBusy(ws.id);
    onError("");
    try {
      await action();
      onRefresh();
    } catch (e) {
      onError(friendlyError(e));
    } finally {
      onBusy(null);
    }
  }

  return (
    <TableRow data-testid="ws-row" data-status={ws.status}>
      <TableCell>{ws.name}</TableCell>
      <TableCell>
        <div className="grid gap-0.5">
          <span>{ws.plan}</span>
          {spec && <span className="text-xs text-muted-foreground">{formatPlanSpec(spec)}</span>}
        </div>
      </TableCell>
      <TableCell className="mono font-mono">{ws.arch}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <Hint label={ws.status} className="font-mono">
            <span className="inline-flex">
              <Badge variant={badgeVariant(ws.status)}>{statusLabel(ws.status)}</Badge>
            </span>
          </Hint>
          {resizePending && (
            <Badge variant="warn" data-testid="ws-resize-pending">
              扩容待审
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="mono font-mono text-muted-foreground">{ws.visibility || "shared"}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {pending && canApprove && (
            <Button
              type="button"
              size="sm"
              data-testid="ws-approve"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/approve`, { method: "POST", body: "{}" });
                  onToast("已批准并开通隔离环境");
                })
              }
            >
              批准开通
            </Button>
          )}
          {pending && canApprove && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="ws-reject"
                disabled={busy}
                onClick={() => setRejectOpen(true)}
              >
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
              size="sm"
              data-testid="ws-resize-approve"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/resize/approve`, { method: "POST", body: "{}" });
                  onToast("已批准扩容");
                })
              }
            >
              批准扩容
            </Button>
          )}
          {resizePending && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="ws-resize-reject"
              disabled={busy}
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
              {canApprove ? "拒绝扩容" : "撤销扩容"}
            </Button>
          )}
          {canResize && (
            <ResizeDialog
              ws={ws}
              disabled={busy}
              onSubmitted={() => {
                onToast("已提交扩容申请，等待管理员审批");
                onRefresh();
              }}
              onError={onError}
            />
          )}
          {canStart && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="ws-start"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/start`, { method: "POST" });
                  onToast("已启动");
                })
              }
            >
              启动
            </Button>
          )}
          {canStop && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="ws-stop"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/workspaces/${ws.id}/stop`, { method: "POST" });
                  onToast("已停止（仍占配额）：销毁后才会释放资源");
                })
              }
            >
              停止
            </Button>
          )}
          {canDestroy && (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                data-testid="ws-destroy"
                disabled={busy}
                onClick={() => setDestroyOpen(true)}
              >
                {pending ? "撤销申请" : "销毁"}
              </Button>
              <AlertDialog open={destroyOpen} onOpenChange={setDestroyOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{pending ? "撤销申请" : "销毁服务器"}</AlertDialogTitle>
                  </AlertDialogHeader>
                  <AlertDialogBody>
                    <AlertDialogDescription>
                      {pending
                        ? `确认撤销「${ws.name}」的申请？`
                        : `确认销毁「${ws.name}」？配额将归还，隔离环境不可恢复。`}
                    </AlertDialogDescription>
                  </AlertDialogBody>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
                    <AlertDialogAction
                      data-testid="confirm-ok"
                      onClick={() => {
                        setDestroyOpen(false);
                        void run(async () => {
                          await api(`/workspaces/${ws.id}`, { method: "DELETE" });
                          onToast(pending ? "已撤销申请" : "已销毁，配额已归还");
                        });
                      }}
                    >
                      确定
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {canSSH && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link data-testid="ws-manage" to={`/workspaces/${ws.id}`}>
                  连接 / 域名
                </Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="ws-copy-ssh"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const info = await api<{ command: string }>(`/workspaces/${ws.id}/connection`);
                    await navigator.clipboard.writeText(info.command);
                    onToast("已复制 SSH 连接命令");
                  })
                }
              >
                复制连接
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="ws-ssh-download"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await downloadSSHConfig(ws.id);
                    onToast("SSH config 已下载（含 Host / RemoteCommand）");
                  })
                }
              >
                下载 SSH
              </Button>
              <ImportKeyDialog
                trigger={
                  <Button type="button" variant="ghost" size="sm" data-testid="ws-import-key" disabled={busy}>
                    导入公钥
                  </Button>
                }
                onImported={() => onToast("公钥已导入，可用该密钥连接跳板")}
              />
            </>
          )}
          <Hint label={ws.id} className="font-mono">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="ws-copy-id"
              disabled={busy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(ws.id);
                  onToast("已复制 workspace id");
                } catch {
                  onError("复制失败，请手动选择 id");
                }
              }}
            >
              复制 id
            </Button>
          </Hint>
        </div>
      </TableCell>
    </TableRow>
  );
}
