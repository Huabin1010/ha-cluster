import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "./button";
import { SelectBox } from "./select";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 20, 50];

type Props = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
};

function pageWindow(page: number, pageCount: number): number[] {
  const span = 5;
  const start = Math.max(1, Math.min(page - Math.floor(span / 2), pageCount - span + 1));
  const end = Math.min(pageCount, start + span - 1);
  const from = Math.max(1, end - span + 1);
  const pages: number[] = [];
  for (let i = from; i <= end; i++) pages.push(i);
  return pages;
}

export function Paginator({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
}: Props) {
  const pages = pageWindow(page, pageCount);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3", className)}
      aria-label="分页"
      data-testid="paginator"
    >
      <p className="m-0 text-xs text-muted-foreground">
        共 {total} 条 · {from}-{to}
      </p>
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2">
        <SelectBox
          aria-label="每页条数"
          testId="page-size"
          className="h-8 w-[4.5rem] shrink-0"
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="hidden h-8 w-8 shrink-0 p-0 sm:inline-flex"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          aria-label="第一页"
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0 p-0"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="上一页"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="shrink-0 px-1 text-xs text-muted-foreground sm:hidden">
          {pageCount === 0 ? 0 : page}/{pageCount}
        </span>
        <div className="hidden items-center gap-1 sm:flex">
          {pages.map((n) => (
            <Button
              key={n}
              type="button"
              variant={n === page ? "default" : "outline"}
              size="sm"
              className="h-8 min-w-8 px-0"
              onClick={() => onPageChange(n)}
              aria-current={n === page ? "page" : undefined}
            >
              {n}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0 p-0"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label="下一页"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="hidden h-8 w-8 shrink-0 p-0 sm:inline-flex"
          disabled={page >= pageCount}
          onClick={() => onPageChange(pageCount)}
          aria-label="最后一页"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
