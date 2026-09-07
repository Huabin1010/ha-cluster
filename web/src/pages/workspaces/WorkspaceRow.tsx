import { api, apiText, friendlyError } from "../../providers";
import { statusLabel, Workspace } from "./types";

type Props = {
  ws: Workspace;
  busyId: string | null;
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
  URL.revokeObjectURL(a.href);
}

export function WorkspaceRow({ ws, busyId, onBusy, onRefresh, onToast, onError }: Props) {
  const busy = busyId === ws.id;
  const canStart = ws.status === "stopped" || ws.status === "fabric_degraded";
  const canStop = ws.status === "running" || ws.status === "fabric_degraded";
  const canDestroy = ws.status !== "destroyed" && ws.status !== "destroying";
  const canSSH = ws.status === "running" || ws.status === "fabric_degraded";

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
    <tr data-testid="ws-row" data-status={ws.status}>
      <td>{ws.name}</td>
      <td>{ws.plan}</td>
      <td className="mono">{ws.arch}</td>
      <td title={ws.status}>{statusLabel(ws.status)}</td>
      <td className="mono muted">{ws.visibility || "shared"}</td>
      <td>
        <div className="actions">
          {canStart && (
            <button
              type="button"
              className="ghost"
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
            </button>
          )}
          {canStop && (
            <button
              type="button"
              className="ghost"
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
            </button>
          )}
          {canDestroy && (
            <button
              type="button"
              className="ghost danger"
              data-testid="ws-destroy"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`确认销毁「${ws.name}」？配额将归还，不可恢复。`)) return;
                run(async () => {
                  await api(`/workspaces/${ws.id}`, { method: "DELETE" });
                  onToast("已销毁，配额已归还");
                });
              }}
            >
              销毁
            </button>
          )}
          {canSSH && (
            <button
              type="button"
              className="ghost"
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
            </button>
          )}
          <button
            type="button"
            className="ghost"
            data-testid="ws-copy-id"
            disabled={busy}
            title={ws.id}
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
          </button>
        </div>
      </td>
    </tr>
  );
}
