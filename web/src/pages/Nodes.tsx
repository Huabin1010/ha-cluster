import { useState } from "react";
import { useGetIdentity, useList } from "@refinedev/core";
import { api, friendlyError } from "../providers";
import { Button, Empty, PageBody, useToast } from "../ui";
import { fmtBytes } from "./ops/format";

type Node = {
  id: string;
  name: string;
  arch: string;
  power: string;
  ready: boolean;
  fabric_ip: string;
  fabric_path?: string;
  fabric_rtt_ms?: number;
  used_mem_bytes: number;
  allocatable_mem_bytes: number;
};

type Identity = { username?: string; platform_role?: string };

type ReconcileResult = { released: number; stale_nodes: number };

function isDegraded(n: Node): boolean {
  return !n.ready || n.fabric_path === "stale" || n.fabric_path === "relay";
}

function readyClass(n: Node): string {
  if (!n.ready) return "badge-danger";
  if (n.fabric_path === "stale" || n.fabric_path === "relay") return "badge-warn";
  return "badge-ok";
}

function pathClass(path?: string): string {
  if (path === "stale" || path === "relay") return "badge-warn";
  return "";
}

export function NodesPage() {
  const { data, isLoading, refetch } = useList<Node>({ resource: "nodes" });
  const { data: me } = useGetIdentity<Identity>();
  const { push } = useToast();
  const rows = data?.data ?? [];
  const [reconciling, setReconciling] = useState(false);
  const isAdmin = me?.platform_role === "platform_admin";

  async function reconcile() {
    setReconciling(true);
    try {
      const out = await api<ReconcileResult>("/admin/reconcile", { method: "POST" });
      push(
        "success",
        `对账完成：释放 ${out.released} 条占用，标记 ${out.stale_nodes} 个 stale 节点。`,
      );
      refetch();
    } catch (e) {
      push("error", friendlyError(e));
    } finally {
      setReconciling(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>节点 / Fabric</h2>
          <p className="muted">
            worker 心跳与 Fabric 路径。Ready=false 或 path=stale/relay 会高亮。
          </p>
        </div>
        {isAdmin && (
          <Button data-testid="nodes-reconcile" disabled={reconciling} type="button" onClick={() => void reconcile()}>
            {reconciling ? "对账中…" : "对账"}
          </Button>
        )}
      </div>

      <PageBody loading={isLoading}>
        {rows.length === 0 ? (
          <Empty text="还没有节点心跳。先跑 ha-agent。" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>arch</th>
                <th>电源</th>
                <th>Ready</th>
                <th>虚 IP</th>
                <th>path</th>
                <th>rtt</th>
                <th>内存占用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id} data-testid="node-row" className={isDegraded(n) ? "warn-row" : undefined}>
                  <td>{n.name}</td>
                  <td className="mono">{n.arch}</td>
                  <td>{n.power}</td>
                  <td>
                    <span className={readyClass(n)} data-testid="node-ready">
                      {n.ready ? "yes" : "no"}
                    </span>
                  </td>
                  <td className="mono">{n.fabric_ip || "—"}</td>
                  <td>
                    <span className={pathClass(n.fabric_path) || undefined}>
                      {n.fabric_path || "—"}
                    </span>
                  </td>
                  <td>{n.fabric_rtt_ms != null ? `${n.fabric_rtt_ms} ms` : "—"}</td>
                  <td>
                    {fmtBytes(n.used_mem_bytes)} / {fmtBytes(n.allocatable_mem_bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageBody>
    </section>
  );
}
