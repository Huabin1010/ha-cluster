import { useList } from "@refinedev/core";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { PageFrame } from "../../components/ui/page-frame";
import { Paginator } from "../../components/ui/pagination";
import { friendlyError } from "../../providers";
import { Empty, PageBody, PageHeader } from "../../ui";
import { fmtBytes, fmtCPU } from "./format";
import { useClientPager } from "../../lib/use-client-pager";

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

  return (
    <PageFrame
      header={
        <div className="grid gap-3">
          <PageHeader
            title="容量池"
            description="按 arch 汇总 Ready worker 的可售 CPU / 内存 / 磁盘（不能混卖）。"
            actions={
              <Button type="button" variant="outline" onClick={() => void refetch()} data-testid="capacity-refresh">
                刷新
              </Button>
            }
          />
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
      <PageBody loading={isLoading}>
        {pools.length === 0 ? (
          <Empty text="暂无可用容量池（可能没有 Ready 的 worker 节点）。" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>arch</TableHead>
                <TableHead>空闲 CPU</TableHead>
                <TableHead>空闲内存</TableHead>
                <TableHead>空闲磁盘</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((p) => (
                <TableRow key={p.arch} data-testid="capacity-row">
                  <TableCell className="mono font-mono">{p.arch}</TableCell>
                  <TableCell>
                    {fmtCPU(p.cpu_milli_free)}{" "}
                    <span className="text-xs text-muted-foreground">({p.cpu_milli_free} milli)</span>
                  </TableCell>
                  <TableCell>{fmtBytes(p.mem_bytes_free)}</TableCell>
                  <TableCell>{fmtBytes(p.disk_bytes_free)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
    </PageFrame>
  );
}
