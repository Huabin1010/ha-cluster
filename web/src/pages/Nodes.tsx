import { useCustomMutation, useGetIdentity, useList } from "@refinedev/core";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { PageFrame } from "../components/ui/page-frame";
import { Paginator } from "../components/ui/pagination";
import { friendlyError } from "../providers";
import { Empty, PageBody, PageHeader } from "../ui";
import { fmtBytes } from "./ops/format";
import { useClientPager } from "../lib/use-client-pager";

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

function readyVariant(n: Node): "ok" | "warn" | "danger" {
  if (!n.ready) return "danger";
  if (n.fabric_path === "stale" || n.fabric_path === "relay") return "warn";
  return "ok";
}

export function NodesPage() {
  const { data, isLoading, refetch } = useList<Node>({
    resource: "nodes",
    pagination: { mode: "off" },
    queryOptions: { refetchInterval: 15_000 },
  });
  const { data: me } = useGetIdentity<Identity>();
  const rows = data?.data ?? [];
  const pager = useClientPager(rows);
  const { mutate: reconcile, isLoading: reconciling } = useCustomMutation<ReconcileResult>();
  const isAdmin = me?.platform_role === "platform_admin";

  return (
    <PageFrame
      header={
        <PageHeader
          title="节点 / Fabric"
          description="worker 心跳与 Fabric 路径。Ready=false 或 path=stale/relay 会高亮。"
          actions={
            isAdmin ? (
              <Button
                data-testid="nodes-reconcile"
                disabled={reconciling}
                type="button"
                onClick={() =>
                  reconcile(
                    {
                      url: "/admin/reconcile",
                      method: "post",
                      values: {},
                      successNotification: (res) => {
                        const out = res?.data;
                        return {
                          message: `对账完成：释放 ${out?.released ?? 0} 条占用，标记 ${out?.stale_nodes ?? 0} 个 stale 节点。`,
                          type: "success",
                        };
                      },
                      errorNotification: (e) => ({
                        message: friendlyError(e),
                        type: "error",
                      }),
                    },
                    { onSuccess: () => refetch() },
                  )
                }
              >
                {reconciling ? "对账中…" : "对账"}
              </Button>
            ) : null
          }
        />
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
        {rows.length === 0 ? (
          <Empty text="还没有节点心跳。先跑 ha-agent。" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>arch</TableHead>
                <TableHead>电源</TableHead>
                <TableHead>Ready</TableHead>
                <TableHead>虚 IP</TableHead>
                <TableHead>path</TableHead>
                <TableHead>rtt</TableHead>
                <TableHead>内存占用</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((n) => (
                <TableRow key={n.id} data-testid="node-row" className={isDegraded(n) ? "bg-[var(--badge-warn-bg)]" : undefined}>
                  <TableCell>{n.name}</TableCell>
                  <TableCell className="mono font-mono">{n.arch}</TableCell>
                  <TableCell>{n.power}</TableCell>
                  <TableCell>
                    <Badge variant={readyVariant(n)} data-testid="node-ready">
                      {n.ready ? "yes" : "no"}
                    </Badge>
                  </TableCell>
                  <TableCell className="mono font-mono">{n.fabric_ip || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={n.fabric_path === "stale" || n.fabric_path === "relay" ? "warn" : "outline"}>
                      {n.fabric_path || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell>{n.fabric_rtt_ms != null ? `${n.fabric_rtt_ms} ms` : "—"}</TableCell>
                  <TableCell>
                    {fmtBytes(n.used_mem_bytes)} / {fmtBytes(n.allocatable_mem_bytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
    </PageFrame>
  );
}
