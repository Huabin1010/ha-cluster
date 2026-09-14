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

/** 列表页顶栏：标题与主操作同一行，长说明仅桌面展示，避免窄屏把列表顶出视口。 */
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
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
          {Icon ? (
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-xs sm:size-9",
                iconClassName,
              )}
            >
              <Icon className="size-4 sm:size-4.5" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-base font-bold tracking-tight text-foreground sm:text-xl">{title}</h2>
              {badges}
            </div>
            {description ? (
              <div className="mt-1 mb-0 hidden min-w-0 text-sm leading-relaxed break-words text-muted-foreground md:block">
                {description}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
