import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Elevated } from "@/lib/elevated";
import { useIsMd } from "@/hooks/use-media-query";

type ResponsiveListProps = {
  table: ReactNode;
  cards: ReactNode;
  className?: string;
};

/** 桌面表格 / 窄屏卡片。只渲染当前断点，避免重复 testid 与重复交互控件。 */
export function ResponsiveList({ table, cards, className }: ResponsiveListProps) {
  const isMd = useIsMd();
  return (
    <div className={cn("min-w-0", className)}>
      {isMd ? <div className="min-w-0">{table}</div> : <div className="grid gap-3">{cards}</div>}
    </div>
  );
}

type TableShellProps = {
  children: ReactNode;
  className?: string;
};

export function TableShell({ children, className }: TableShellProps) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1", className)}>
      {children}
    </div>
  );
}

type ListCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function ListCard({ children, className, ...props }: ListCardProps) {
  return (
    <Elevated
      offset={1}
      shadowLevel={1}
      className={cn("rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1", className)}
      {...props}
    >
      {children}
    </Elevated>
  );
}

export function ListCardHeader({
  leading,
  title,
  trailing,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-2", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <div className="min-w-0 truncate font-medium text-foreground">{title}</div>
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
    </div>
  );
}

export function ListCardMeta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function ListCardActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-3 flex flex-wrap items-center gap-1.5", className)}>
      {children}
    </div>
  );
}
