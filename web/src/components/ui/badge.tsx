import { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        ok: "badge-ok bg-[var(--badge-ok-bg)] text-[var(--badge-ok-text)]",
        warn: "badge-warn bg-[var(--badge-warn-bg)] text-[var(--badge-warn-text)]",
        danger: "badge-danger bg-[var(--badge-danger-bg)] text-[var(--badge-danger-text)]",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
