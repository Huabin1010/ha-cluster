import { useMemo } from "react";
import { useList } from "@refinedev/core";
import { Cpu, Database, HardDrive, Layers, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageFrame } from "@/components/ui/page-frame";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { friendlyError } from "@/providers";
import { Loading } from "@/ui";
import { fmtBytes, fmtCPU } from "./format";
import { useClientPager } from "@/lib/use-client-pager";

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

  return (
    <PageFrame
      header={
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20 shadow-xs">
                <Database className="size-4.5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">算力容量池</h2>
                  <Badge variant="outline" className="px-2 py-0.5 text-xs font-mono font-normal">
                    {pools.length} 个架构池
                  </Badge>
                </div>
                <p className="mt-1 mb-0 text-sm text-muted-foreground">
                  按 CPU 架构（amd64 / arm64）硬占用隔离汇总 Ready 宿主机的剩余可分配算力，杜绝跨架构超卖与混跑。
                </p>
              </div>
            </div>

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
          </div>

          {/* 指标汇总卡片条 */}
          {pools.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Layers className="size-3.5 text-primary" /> 可用架构池
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {summary.poolCount} <span className="text-xs font-normal text-muted-foreground">个</span>
                </div>
              </Elevated>

              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Cpu className="size-3.5 text-emerald-500" /> 可分配 CPU
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {fmtCPU(summary.cpuMilli)}
                </div>
              </Elevated>

              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <HardDrive className="size-3.5 text-sky-500" /> 剩余可用内存
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {fmtBytes(summary.memBytes)}
                </div>
              </Elevated>

              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Database className="size-3.5 text-purple-500" /> 剩余可用磁盘
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {fmtBytes(summary.diskBytes)}
                </div>
              </Elevated>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{friendlyError(error)}</AlertDescription>
            </Alert>
          )}
        </div>
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
        <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
          <Table className="min-w-[700px]">
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
      )}
    </PageFrame>
  );
}
