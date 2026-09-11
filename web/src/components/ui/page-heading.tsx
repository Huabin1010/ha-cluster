import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  icon?: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** 列表页顶栏：窄屏纵向堆叠，避免标题与按钮叠字、操作被挤出视口。 */
export function PageHeading({
  icon: Icon,
  iconClassName,
  title,
  badges,
  description,
  actions,
  children,
  className,
}: Props) {
  return (
    <div className={cn("flex flex-col gap-3 sm:gap-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-xs",
                iconClassName,
              )}
            >
              <Icon className="size-4.5" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-lg font-bold tracking-tight text-foreground sm:text-xl">{title}</h2>
              {badges}
            </div>
            {description ? (
              <div className="mt-1 mb-0 min-w-0 text-sm leading-relaxed break-words text-muted-foreground">
                {description}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
