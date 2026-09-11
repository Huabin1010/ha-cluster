import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** 顶部固定 / 中间滚动 / 底部固定 paginator */
export function PageFrame({ header, footer, children, className }: Props) {
  return (
    <section className={cn("flex h-full min-h-0 flex-1 flex-col", className)}>
      <div className="shrink-0 pb-3">{header}</div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {footer ? <div className="shrink-0 border-t border-border pt-3">{footer}</div> : null}
    </section>
  );
}
