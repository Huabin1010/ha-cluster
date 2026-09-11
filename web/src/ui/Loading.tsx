import { Spinner } from "@/components/ui/spinner";
import { Skeleton as ShadcnSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Props = {
  label?: string;
  block?: boolean;
};

export function Loading({ label = "加载中…", block = true }: Props) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground",
        block && "min-h-48 justify-center",
      )}
      role="status"
      aria-live="polite"
      data-testid="page-loading"
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-2.5 py-2" aria-hidden data-testid="page-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <ShadcnSkeleton key={i} className="h-3.5" style={{ width: `${88 - (i % 3) * 12}%` }} />
      ))}
    </div>
  );
}
