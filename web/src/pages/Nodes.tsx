import { FormEvent, useState } from "react";
import { useCustomMutation, useGetIdentity, useList } from "@refinedev/core";
import { api, friendlyError } from "../providers";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field } from "../components/ui/field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Hint } from "../components/ui/tooltip";
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
  health_status?: string;
  fabric_ip: string;
  fabric_path?: string;
  fabric_rtt_ms?: number;
  cpu_usage_pct?: number;
  mem_available_bytes?: number;
  disk_free_bytes?: number;
  used_mem_bytes: number;
  allocatable_mem_bytes: number;
  used_cpu_milli: number;
  allocatable_cpu_milli: number;
};

type Identity = { username?: string; platform_role?: string };

type ReconcileResult = { released: number; stale_nodes: number };

function healthVariant(n: Node): "ok" | "warn" | "danger" {
  if (n.health_status === "offline" || !n.ready) return "danger";
  if (n.health_status === "degraded" || n.fabric_path === "relay") return "warn";
  return "ok";
}

function healthLabel(n: Node): string {
  if (n.health_status) return n.health_status;
  return n.ready ? "healthy" : "offline";
}

function memUsagePct(n: Node): number {
  if (!n.allocatable_mem_bytes) return 0;
  return Math.min(100, Math.round((n.used_mem_bytes / n.allocatable_mem_bytes) * 100));
}

function isLowMem(n: Node): boolean {
  if (!n.mem_available_bytes || !n.allocatable_mem_bytes) return false;
  return n.mem_available_bytes < n.allocatable_mem_bytes * 0.1;
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
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinErr, setJoinErr] = useState("");
  const [cluster, setCluster] = useState("ha-cluster");
  const [secret, setSecret] = useState("");
  const [joinCmd, setJoinCmd] = useState("");
  const [copied, setCopied] = useState(false);

  async function generateJoinToken(e: FormEvent) {
    e.preventDefault();
    setJoinErr("");
    setJoinBusy(true);
    setJoinCmd("");
    try {
      const out = await api<{ token: string }>("/admin/join-tokens", {
        method: "POST",
        body: JSON.stringify({
          cluster: cluster.trim(),
          secret: secret.trim(),
          api: "https://ha.mnnumath.vip/api",
          depot_public: "https://rustfs.s.ggss.club:50000/typora/ha-cluster",
        }),
      });
      const install =
        "curl -fsSL https://rustfs.s.ggss.club:50000/typora/ha-cluster/install.sh | sudo bash -s join --token '" +
        out.token +
        "'";
      setJoinCmd(install);
    } catch (err) {
      setJoinErr(friendlyError(err));
    } finally {
      setJoinBusy(false);
    }
  }

  const readyCount = rows.filter((n) => n.ready).length;
  const degradedCount = rows.filter((n) => n.health_status === "degraded").length;
  const offlineCount = rows.filter((n) => n.health_status === "offline" || (!n.ready && n.health_status !== "degraded")).length;
  const oomRisk = rows.filter(isLowMem).length;

  return (
    <PageFrame
      header={
        <PageHeader
          title="节点 / Fabric"
          description="worker 心跳、实时负载与健康状态。degraded/offline 仅影响调度，不会销毁边缘工作区。"
          actions={
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => void refetch()} data-testid="nodes-refresh">
                刷新
              </Button>
              {isAdmin && (
                <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline" data-testid="nodes-join-token-open">
                      生成 join token
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>纳管新节点</DialogTitle>
                      <DialogDescription>在目标宿主机以 root 执行下方一行命令（仅 platform_admin）。</DialogDescription>
                    </DialogHeader>
                    <form className="flex min-h-0 flex-1 flex-col" onSubmit={generateJoinToken}>
                      <DialogBody className="grid gap-4">
                        <Field label="cluster">
                          <Input value={cluster} onChange={(e) => setCluster(e.target.value)} required />
                        </Field>
                        <Field label="secret（一次性随机串）">
                          <Input
                            data-testid="join-secret"
                            value={secret}
                            onChange={(e) => setSecret(e.target.value)}
                            placeholder="随机 secret"
                            required
                          />
                        </Field>
                        {joinErr && (
                          <Alert variant="destructive">
                            <AlertDescription>{joinErr}</AlertDescription>
                          </Alert>
                        )}
                        {joinCmd && (
                          <Alert variant="info" data-testid="join-command">
                            <AlertDescription>
                              <code className="block break-all font-mono text-xs">{joinCmd}</code>
                            </AlertDescription>
                          </Alert>
                        )}
                      </DialogBody>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setJoinOpen(false)}>关闭</Button>
                        <Button type="submit" data-testid="join-generate" disabled={joinBusy}>
                          {joinBusy ? "生成中…" : "生成命令"}
                        </Button>
                        {joinCmd && (
                          <Button
                            type="button"
                            data-testid="join-copy"
                            onClick={async () => {
                              await navigator.clipboard.writeText(joinCmd);
                              setCopied(true);
                            }}
                          >
                            {copied ? "已复制" : "复制命令"}
                          </Button>
                        )}
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              )}
              {isAdmin && (
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
                            message: `对账完成：释放 ${out?.released ?? 0} 条占用，标记 ${out?.stale_nodes ?? 0} 个离线节点。`,
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
              )}
            </div>
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
        {rows.length > 0 && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="nodes-metrics-cards">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Ready 节点</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{readyCount}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Degraded</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-[var(--badge-warn-fg)]">{degradedCount}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Offline</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-[var(--badge-danger-fg)]">{offlineCount}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">内存预警</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{oomRisk}</CardContent>
            </Card>
          </div>
        )}
        {rows.length === 0 ? (
          <Empty text="还没有节点心跳。先跑 ha-agent。" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>arch</TableHead>
                <TableHead>健康</TableHead>
                <TableHead>虚 IP</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>内存</TableHead>
                <TableHead>rtt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((n) => (
                <TableRow
                  key={n.id}
                  data-testid="node-row"
                  className={healthVariant(n) !== "ok" ? "bg-[var(--badge-warn-bg)]" : undefined}
                >
                  <TableCell>{n.name}</TableCell>
                  <TableCell className="mono font-mono">{n.arch}</TableCell>
                  <TableCell>
                    <Hint label={`path: ${n.fabric_path || "—"}`}>
                      <Badge variant={healthVariant(n)} data-testid="node-ready">
                        {healthLabel(n)}
                      </Badge>
                    </Hint>
                  </TableCell>
                  <TableCell className="mono font-mono">{n.fabric_ip || "—"}</TableCell>
                  <TableCell>
                    {n.cpu_usage_pct != null ? `${n.cpu_usage_pct.toFixed(1)}%` : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-[8rem] flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        {fmtBytes(n.used_mem_bytes)} / {fmtBytes(n.allocatable_mem_bytes)}
                        {n.mem_available_bytes != null && ` · 可用 ${fmtBytes(n.mem_available_bytes)}`}
                      </span>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${memUsagePct(n)}%` }}
                        />
                      </div>
                      {isLowMem(n) && (
                        <Badge variant="danger" className="w-fit text-xs">OOM 风险</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{n.fabric_rtt_ms != null ? `${n.fabric_rtt_ms} ms` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
    </PageFrame>
  );
}
