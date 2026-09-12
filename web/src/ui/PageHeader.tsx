import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, className }: Props) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4", className)}>
      <div className="min-w-0">
        <h2 className="m-0 text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
        {description && (
          <p className="mt-1 mb-0 min-w-0 text-sm leading-relaxed break-words text-muted-foreground">{description}</p>
        )}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
