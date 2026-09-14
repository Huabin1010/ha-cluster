import { useMemo } from "react";
import { useList } from "@refinedev/core";
import { Cpu, Database, HardDrive, Layers, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListCard, ListCardHeader, ListCardMeta, ResponsiveList } from "@/components/ui/responsive-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { friendlyError } from "@/providers";
import { Loading } from "@/ui";
import { fmtBytes, fmtCPU } from "./format";
import { useClientPager } from "@/lib/use-client-pager";
import { useIsMd } from "@/hooks/use-media-query";

type Pool = {
  id?: string;
  arch: string;
  cpu_milli_free: number;
  mem_bytes_free: number;
  disk_bytes_free: number;
};

export function CapacityPage() {
  const { data, isLoading, error, refetch } = useList<Pool>({
    resource: "capacity",
    pagination: { mode: "off" },
    errorNotification: false,
  });
  const pools = data?.data ?? [];
  const pager = useClientPager(pools);

  // 汇总总可售资源
  const summary = useMemo(() => {
    let cpuMilli = 0;
    let memBytes = 0;
    let diskBytes = 0;
    for (const p of pools) {
      cpuMilli += p.cpu_milli_free || 0;
      memBytes += p.mem_bytes_free || 0;
      diskBytes += p.disk_bytes_free || 0;
    }
    return {
      cpuMilli,
      memBytes,
      diskBytes,
      poolCount: pools.length,
    };
  }, [pools]);
  const isMd = useIsMd();

  const metricsBar =
    pools.length > 0 ? (
            <div className="grid grid-cols-4 gap-1.5 md:gap-3">
              {(
                [
                  { short: "池", label: "可用架构池", value: String(summary.poolCount), unit: "个", icon: Layers, iconClass: "text-primary" },
                  { short: "CPU", label: "可分配 CPU", value: fmtCPU(summary.cpuMilli), unit: "", icon: Cpu, iconClass: "text-emerald-500" },
                  { short: "内存", label: "剩余可用内存", value: fmtBytes(summary.memBytes), unit: "", icon: HardDrive, iconClass: "text-sky-500" },
                  { short: "磁盘", label: "剩余可用磁盘", value: fmtBytes(summary.diskBytes), unit: "", icon: Database, iconClass: "text-purple-500" },
                ] as const
              ).map((stat) => (
              <Elevated
                key={stat.short}
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-2 md:p-3.5 shadow-surface-1 flex min-w-0 flex-col justify-between"
              >
                <span className="text-[10px] md:text-xs font-medium text-muted-foreground inline-flex items-center gap-1 md:gap-1.5 min-w-0">
                  <stat.icon className={`size-3 md:size-3.5 shrink-0 ${stat.iconClass}`} />
                  <span className="truncate md:hidden">{stat.short}</span>
                  <span className="hidden md:inline truncate">{stat.label}</span>
                </span>
                <div className="text-sm md:text-xl font-bold tracking-tight text-foreground font-mono mt-0.5 md:mt-1">
                  {stat.value}{stat.unit ? <> <span className="text-[10px] md:text-xs font-normal text-muted-foreground">{stat.unit}</span></> : null}
                </div>
              </Elevated>
              ))}
            </div>
    ) : null;

  return (
    <PageFrame
      header={
        <PageHeading
          icon={Database}
          title="算力容量池"
          badges={
            <Badge variant="outline" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal">
              {pools.length} 个架构池
            </Badge>
          }
          description="按 CPU 架构（amd64 / arm64）硬占用隔离汇总 Ready 宿主机的剩余可分配算力，杜绝跨架构超卖与混跑。"
          actions={
            <Button
              type="button"
              variant="outline"
              size="compact"
              onClick={() => void refetch()}
              data-testid="capacity-refresh"
              className="h-8 px-3 text-xs gap-1.5 shrink-0"
            >
              <RefreshCw className="size-3.5 opacity-70 shrink-0" />
              刷新容量
            </Button>
          }
        >

          {isMd ? metricsBar : null}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{friendlyError(error)}</AlertDescription>
            </Alert>
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
      {!isMd && metricsBar ? <div className="mb-3">{metricsBar}</div> : null}
      {isLoading ? (
        <div className="py-12 text-center">
          <Loading label="计算集群容量池…" />
        </div>
      ) : pools.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center">
          <Elevated
            offset={1}
            shadowLevel={2}
            className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-md w-full flex flex-col items-center gap-3"
          >
            <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
              <Database className="size-6" />
            </div>
            <div>
              <h3 className="m-0 text-base font-semibold text-foreground">暂无可用容量池</h3>
              <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                当前集群可能尚未接入就绪（Ready）状态的宿主机节点。请前往「节点」页面纳管 worker 主机。
              </p>
            </div>
          </Elevated>
        </div>
      ) : (
        <ResponsiveList
          table={
        <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
          <Table data-testid="capacity-table" stackOnMobile={false} className="min-w-[700px]">
            <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none">
              <TableRow className="border-b border-border/60 hover:bg-transparent">
                <TableHead className="w-[180px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Cpu className="size-3.5 opacity-60 shrink-0" />
                    处理器架构 (arch)
                  </span>
                </TableHead>
                <TableHead className="py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Layers className="size-3.5 opacity-60 shrink-0" />
                    空闲 CPU 可分配算力
                  </span>
                </TableHead>
                <TableHead className="w-[200px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <HardDrive className="size-3.5 opacity-60 shrink-0" />
                    空闲物理内存
                  </span>
                </TableHead>
                <TableHead className="w-[200px] py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Database className="size-3.5 opacity-60 shrink-0" />
                    空闲存储空间
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((p) => (
                <TableRow key={p.arch} data-testid="capacity-row">
                  <TableCell className="py-2.5 whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />
                      <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
                        {p.arch}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 font-medium whitespace-nowrap">
                    <span className="font-mono text-foreground">{fmtCPU(p.cpu_milli_free)}</span>
                    <span className="text-xs text-muted-foreground ml-2 font-mono">({p.cpu_milli_free} milli)</span>
                  </TableCell>
                  <TableCell className="py-2.5 font-mono text-xs whitespace-nowrap text-foreground">
                    {fmtBytes(p.mem_bytes_free)}
                  </TableCell>
                  <TableCell className="py-2.5 font-mono text-xs whitespace-nowrap text-foreground">
                    {fmtBytes(p.disk_bytes_free)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
          }
          cards={pager.slice.map((p) => (
            <ListCard key={p.arch} data-testid="capacity-row">
              <ListCardHeader
                leading={<span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />}
                title={<Badge variant="outline" className="font-mono text-xs px-2 py-0.5">{p.arch}</Badge>}
              />
              <ListCardMeta className="text-foreground">
                <span className="inline-flex items-center gap-1 shrink-0 font-mono">
                  <Cpu className="size-3 opacity-60 shrink-0" />
                  {fmtCPU(p.cpu_milli_free)}
                </span>
                <span className="inline-flex items-center gap-1 shrink-0 font-mono">
                  <HardDrive className="size-3 opacity-60 shrink-0" />
                  {fmtBytes(p.mem_bytes_free)}
                </span>
                <span className="inline-flex items-center gap-1 shrink-0 font-mono">
                  <Database className="size-3 opacity-60 shrink-0" />
                  {fmtBytes(p.disk_bytes_free)}
                </span>
              </ListCardMeta>
            </ListCard>
          ))}
        />
      )}
    </PageFrame>
  );
}
