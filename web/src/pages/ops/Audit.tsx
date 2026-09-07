import { useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { api, ApiError, friendlyError } from "../../providers";
import { Button, Empty, PageBody, useToast } from "../../ui";
import { fmtTime } from "./format";

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

function shortId(id?: string): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function AuditPage() {
  const { data: me } = useGetIdentity<Identity>();
  const { push } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const canReconcile = me?.platform_role === "platform_admin";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      setForbidden(false);
      try {
        const json = await api<{ data: AuditLog[] }>("/audit-logs");
        if (!cancelled) setLogs(json.data ?? []);
      } catch (e) {
        if (!cancelled) {
          if ((e as ApiError).status === 403) {
            setForbidden(true);
          } else {
            setErr(friendlyError(e));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reconcile() {
    setReconciling(true);
    try {
      const out = await api<ReconcileResult>("/admin/reconcile", { method: "POST" });
      push(
        "success",
        `对账完成：released=${out.released} stale_nodes=${out.stale_nodes}`,
      );
    } catch (e) {
      push("error", friendlyError(e));
    } finally {
      setReconciling(false);
    }
  }

  if (forbidden) {
    return (
      <section>
        <h2>审计日志</h2>
        <p className="error" data-testid="audit-forbidden">
          你没有权限查看审计日志。
        </p>
        <p className="muted">仅 platform_admin / platform_ops 可访问此页。</p>
      </section>
    );
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>审计日志</h2>
          <p className="muted">最近 200 条平台操作记录（登录、创建 Workspace 等）。</p>
        </div>
        {canReconcile && (
          <Button data-testid="audit-reconcile" disabled={reconciling} type="button" onClick={() => void reconcile()}>
            {reconciling ? "对账中…" : "对账"}
          </Button>
        )}
      </div>
      {err && <p className="error">{err}</p>}
      <PageBody loading={loading}>
        {logs.length === 0 ? (
          <Empty text="暂无审计记录。" />
        ) : (
          <table data-testid="audit-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>资源</th>
                <th>操作者</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{fmtTime(l.created_at)}</td>
                  <td>{l.action}</td>
                  <td className="mono">
                    {l.resource_type}
                    {l.resource_id ? `:${shortId(l.resource_id)}` : ""}
                  </td>
                  <td className="mono">{shortId(l.actor_user_id)}</td>
                  <td className="mono">{l.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageBody>
    </section>
  );
}
