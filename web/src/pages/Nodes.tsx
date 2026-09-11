import { FormEvent, useMemo, useState } from "react";
import { useCustomMutation, useGetIdentity, useList } from "@refinedev/core";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Gauge,
  Globe,
  HardDrive,
  HeartPulse,
  KeyRound,
  MemoryStick,
  RefreshCw,
  Server,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, friendlyError } from "@/providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Hint } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { Empty, PageBody, PageHeader } from "@/ui";
import { fmtBytes } from "@/pages/ops/format";
import { copyText } from "@/ui/format";
import { hostDiskMeter, hostMemMeter, isHostPressure } from "./node-resources";
import { useClientPager } from "@/lib/use-client-pager";
import { cn } from "@/lib/utils";

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
  mem_total_bytes?: number;
  disk_total_bytes?: number;
  used_mem_bytes: number;
  allocatable_mem_bytes: number;
  used_disk_bytes: number;
  allocatable_disk_bytes: number;
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
  if (n.health_status === "degraded") return "降级 (Relay)";
  if (n.health_status === "offline" || (!n.ready && n.health_status !== "degraded")) return "离线";
  return n.ready ? "健康在线" : "离线";
}

function nodeStatusDot(n: Node) {
  if (n.health_status === "offline" || !n.ready) {
    return "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]";
  }
  if (n.health_status === "degraded") {
    return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.45)]";
  }
  return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]";
}

function usagePct(used: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function nodeRank(n: Node): number {
  if (n.health_status === "offline" || !n.ready) return 2;
  if (n.health_status === "degraded") return 1;
  return 0;
}

function nodeRowClass(n: Node): string | undefined {
  const variant = healthVariant(n);
  if (variant === "danger") {
    return "danger-row bg-rose-50 hover:bg-rose-100/80 dark:bg-rose-500/10 dark:hover:bg-rose-500/15";
  }
  if (variant === "warn") {
    return "warn-row bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-500/5 dark:hover:bg-amber-500/10";
  }
  return undefined;
}

function ResourceMeter({
  icon: Icon,
  meter,
  warn,
  testId,
}: {
  icon: LucideIcon;
  meter: ReturnType<typeof hostMemMeter>;
  warn?: boolean;
  testId?: string;
}) {
  const pct = usagePct(meter.used, meter.total);
  const hint =
    meter.source === "host"
      ? `宿主机已用 ${fmtBytes(meter.used)} / 共 ${fmtBytes(meter.total)}（剩余 ${fmtBytes(meter.free)}）· 账本占用 ${fmtBytes(meter.ledgerUsed)} / 可分配 ${fmtBytes(meter.ledgerTotal)}`
      : `账本占用 ${fmtBytes(meter.ledgerUsed)} / 可分配 ${fmtBytes(meter.ledgerTotal)}`;

  return (
    <Hint label={hint}>
      <div className="flex min-w-[8.5rem] flex-col gap-0.5" data-testid={testId}>
        <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px] leading-none">
          <Icon className="size-3 shrink-0 opacity-70" />
          <span className="text-foreground">
            {fmtBytes(meter.used)} / {fmtBytes(meter.total)}
          </span>
        </span>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              warn || pct > 85 ? "bg-rose-500" : "bg-accent",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </Hint>
  );
}

export function NodesPage() {
  const { data, isLoading, refetch } = useList<Node>({
    resource: "nodes",
    pagination: { mode: "off" },
    filters: [{ field: "all", operator: "eq", value: "1" }],
    queryOptions: { refetchInterval: 15_000 },
  });
  const { data: me } = useGetIdentity<Identity>();
  const rows = useMemo(() => {
    const list = data?.data ?? [];
    return [...list].sort((a, b) => {
      const d = nodeRank(a) - nodeRank(b);
      return d !== 0 ? d : a.name.localeCompare(b.name, "en");
    });
  }, [data?.data]);
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
  const oomRisk = rows.filter((n) => isHostPressure(hostMemMeter(n))).length;

  return (
    <PageFrame
      header={
        <PageHeading
          icon={Cpu}
          title="节点 / Fabric"
          badges={
            <>
              <Badge variant="outline" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal">
                {rows.length} 台
              </Badge>
              {readyCount > 0 && (
                <Badge variant="ok" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-normal">
                  {readyCount} 在线
                </Badge>
              )}
              {offlineCount > 0 && (
                <Badge variant="danger" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-normal">
                  {offlineCount} 离线
                </Badge>
              )}
            </>
          }
          description="在线与离线 worker 一并列出；离线行会标红，方便对账和排障。"
          actions={
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-background p-1 shadow-xs w-full sm:w-auto">
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => void refetch()}
                data-testid="nodes-refresh"
                className="h-8 px-3 text-xs gap-1.5 shrink-0"
              >
                <RefreshCw className="size-3.5 opacity-70 shrink-0" />
                刷新
              </Button>
              {isAdmin && (
                <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline" size="compact" data-testid="nodes-join-token-open" className="h-8 px-3 text-xs gap-1.5 shrink-0">
                      <KeyRound className="size-3.5 shrink-0" />
                      生成 join token
                    </Button>
                  </DialogTrigger>
                  <DialogContent size="lg" className="sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle>纳管新节点</DialogTitle>
                      <DialogDescription>在目标宿主机以 root 执行下方一行命令（仅 platform_admin）。</DialogDescription>
                    </DialogHeader>
                    <form className="flex min-h-0 flex-1 flex-col" onSubmit={generateJoinToken}>
                      <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
                        <Field label="cluster">
                          <Input className="border-(--line-strong) bg-(--input-bg)" value={cluster} onChange={(e) => setCluster(e.target.value)} required />
                        </Field>
                        <Field label="secret（一次性随机串）">
                          <Input
                            data-testid="join-secret"
                            className="border-(--line-strong) bg-(--input-bg)"
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
                              <code className="block break-all font-mono text-xs select-all bg-background/50 p-2 rounded border border-border/60">
                                {joinCmd}
                              </code>
                            </AlertDescription>
                          </Alert>
                        )}
                      </DialogBody>
                      <DialogFooter className="gap-2">
                        <Button type="button" variant="outline" onClick={() => setJoinOpen(false)}>关闭</Button>
                        <Button type="submit" data-testid="join-generate" disabled={joinBusy}>
                          {joinBusy ? "生成中…" : "生成命令"}
                        </Button>
                        {joinCmd && (
                          <Button
                            type="button"
                            data-testid="join-copy"
                            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            onClick={async () => {
                              const ok = await copyText(joinCmd);
                              if (!ok) return;
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2500);
                            }}
                          >
                            {copied ? (
                              <>
                                <Check className="size-3.5 text-emerald-500" />
                                已复制命令
                              </>
                            ) : (
                              <>
                                <Copy className="size-3.5 opacity-70" />
                                复制命令
                              </>
                            )}
                          </Button>
                        )}
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              )}
              {isAdmin && (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  data-testid="nodes-reconcile"
                  disabled={reconciling}
                  className="h-8 px-3 text-xs gap-1.5 shrink-0"
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
                  <RefreshCw className={cn("size-3.5 shrink-0", reconciling && "animate-spin")} />
                  {reconciling ? "对账中…" : "对账"}
                </Button>
              )}
            </div>
          }
        >

          {/* 指标卡片条 */}
          {rows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="nodes-metrics-cards">
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border bg-background p-3.5 shadow-xs flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-500" /> 在线 Ready
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {readyCount} <span className="text-xs font-normal text-muted-foreground">台</span>
                </div>
              </Elevated>

              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border bg-background p-3.5 shadow-xs flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <AlertTriangle className="size-3.5 text-amber-500" /> 网络降级
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-amber-500 font-mono mt-1">
                  {degradedCount} <span className="text-xs font-normal text-muted-foreground">台</span>
                </div>
              </Elevated>

              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border bg-background p-3.5 shadow-xs flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <WifiOff className="size-3.5 text-rose-500" /> 离线节点
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-rose-500 font-mono mt-1">
                  {offlineCount} <span className="text-xs font-normal text-muted-foreground">台</span>
                </div>
              </Elevated>

              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border bg-background p-3.5 shadow-xs flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Activity className="size-3.5 text-primary" /> 内存预警
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {oomRisk} <span className="text-xs font-normal text-muted-foreground">台</span>
                </div>
              </Elevated>
            </div>
          )}
        </PageHeading>
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
          <div className="py-8 flex flex-col items-center justify-center">
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border bg-background p-8 shadow-xs text-center max-w-md w-full flex flex-col items-center gap-3"
            >
              <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
                <Cpu className="size-6" />
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-foreground">暂无节点心跳</h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  请先在物理机或目标虚拟机上运行 ha-agent，或点击右上角「生成 join token」一键纳管节点。
                </p>
              </div>
            </Elevated>
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
            <Table className="min-w-[960px]">
              <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs border-b border-border/70 select-none">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="py-2.5 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Server className="size-3.5 opacity-60 shrink-0" />
                      节点主机名
                    </span>
                  </TableHead>
                  <TableHead className="w-[110px] py-2.5 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Cpu className="size-3.5 opacity-60 shrink-0" />
                      架构
                    </span>
                  </TableHead>
                  <TableHead className="w-[130px] py-2.5 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <HeartPulse className="size-3.5 opacity-60 shrink-0" />
                      健康状态
                    </span>
                  </TableHead>
                  <TableHead className="w-[150px] py-2.5 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Globe className="size-3.5 opacity-60 shrink-0" />
                      Fabric 虚 IP
                    </span>
                  </TableHead>
                  <TableHead className="w-[110px] py-2.5 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Gauge className="size-3.5 opacity-60 shrink-0" />
                      CPU 使用率
                    </span>
                  </TableHead>
                  <TableHead className="w-[240px] py-2.5 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <MemoryStick className="size-3.5 opacity-60 shrink-0" />
                      内存 / 硬盘
                    </span>
                  </TableHead>
                  <TableHead className="w-[110px] py-2.5 pr-4 text-right text-muted-foreground">
                    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">
                      <Activity className="size-3.5 opacity-60 shrink-0" />
                      延迟 (RTT)
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.slice.map((n) => (
                  <TableRow
                    key={n.id}
                    data-testid="node-row"
                    className={nodeRowClass(n)}
                  >
                    <TableCell className="py-2.5">
                      <span className="font-medium text-foreground whitespace-nowrap inline-flex items-center gap-2">
                        <span className={cn("size-2 rounded-full shrink-0 transition-all", nodeStatusDot(n))} />
                        <Server className="size-3.5 opacity-50 shrink-0" />
                        {n.name}
                      </span>
                    </TableCell>
                    <TableCell className="mono font-mono py-2.5 whitespace-nowrap text-xs">{n.arch}</TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <Hint label={`path: ${n.fabric_path || "direct"}`}>
                        <Badge variant={healthVariant(n)} data-testid="node-ready">
                          {healthLabel(n)}
                        </Badge>
                      </Hint>
                    </TableCell>
                    <TableCell className="mono font-mono py-2.5 whitespace-nowrap text-xs text-muted-foreground">{n.fabric_ip || "—"}</TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap font-mono text-xs">
                      {n.cpu_usage_pct != null ? `${n.cpu_usage_pct.toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex flex-col gap-1.5">
                        <ResourceMeter
                          icon={MemoryStick}
                          meter={hostMemMeter(n)}
                          warn={isHostPressure(hostMemMeter(n))}
                          testId="node-mem"
                        />
                        <ResourceMeter
                          icon={HardDrive}
                          meter={hostDiskMeter(n)}
                          warn={isHostPressure(hostDiskMeter(n))}
                          testId="node-disk"
                        />
                        {isHostPressure(hostMemMeter(n)) && (
                          <Badge variant="danger" className="w-fit text-[10px] px-1.5 py-0">OOM 风险</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap text-right pr-4 font-mono text-xs text-muted-foreground">
                      {n.fabric_rtt_ms != null ? `${n.fabric_rtt_ms} ms` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </PageFrame>
  );
}
