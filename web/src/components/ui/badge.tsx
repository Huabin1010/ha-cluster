"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useSizeVariant } from "@/lib/size-context";

const badgeColors = {
  gray: "#a3a3a3",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
} as const;

type BadgeColor = keyof typeof badgeColors;

const badgeVariants = cva(
  "inline-flex items-center justify-center font-medium whitespace-nowrap shrink-0 select-none",
  {
    variants: {
      variant: {
        solid: "",
        dot: "border border-border text-foreground",
        ok: "badge-ok bg-[var(--badge-ok-bg)] text-[var(--badge-ok-text)]",
        warn: "badge-warn bg-[var(--badge-warn-bg)] text-[var(--badge-warn-text)]",
        danger: "badge-danger bg-[var(--badge-danger-bg)] text-[var(--badge-danger-text)]",
        outline: "border border-border text-muted-foreground",
        default: "border border-border text-foreground",
        secondary: "bg-surface-2 text-foreground",
      },
      // The two-step size ladder shared by every control — see /docs/sizes.
      size: {
        default: "h-6 px-2.5 text-[12px] gap-1.5",
        compact: "h-5 px-2 text-[11px] gap-1",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "default",
    },
  },
);

type BadgeSizeCanonical = "default" | "compact";

/** Public size values: the canonical two-size scale plus the pre-sizes-system
 *  aliases, kept so existing call sites keep compiling. Aliases resolve onto
 *  the canonical ladder (sm → compact; md/lg → default). */
type BadgeSize = BadgeSizeCanonical | "sm" | "md" | "lg";

const legacySizeAliases: Partial<Record<BadgeSize, BadgeSizeCanonical>> = {
  sm: "compact",
  md: "default",
  lg: "default",
};

interface BadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "color">,
    Omit<VariantProps<typeof badgeVariants>, "size"> {
  color?: BadgeColor;
  /** Explicitly show/hide the indicator dot. Defaults to true for variant="dot", false otherwise. */
  dot?: boolean;
  /** Omitted, the badge follows the surrounding SizeProvider. Legacy
   *  sm/md/lg values still resolve. */
  size?: BadgeSize;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      variant = "solid",
      size: sizeProp,
      color = "gray",
      dot,
      children,
      style,
      ...props
    },
    ref,
  ) => {
    const shape = useShape();
    // Resolve the size: explicit prop (legacy aliases mapped onto the
    // canonical ladder) > surrounding SizeProvider > default.
    const contextSize = useSizeVariant();
    const size: BadgeSizeCanonical = sizeProp
      ? legacySizeAliases[sizeProp] ?? (sizeProp as BadgeSizeCanonical)
      : contextSize === "compact"
        ? "compact"
        : "default";
    const colorValue = badgeColors[color];
    const isSolid = variant === "solid";
    const showDot = dot ?? variant === "dot";
    const dotSize = size === "compact" ? 6 : 7;

    const colorStyle = isSolid
      ? color === "gray"
        ? { backgroundColor: "var(--accent)", color: "var(--foreground)" }
        : {
            color: "var(--foreground)",
            backgroundColor: `color-mix(in srgb, ${colorValue} 15%, var(--background))`,
          }
      : {};

    const dotColor = color === "gray" ? "var(--muted-foreground)" : colorValue;

    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant, size }), shape.item, className)}
        style={{ ...colorStyle, ...style }}
        {...props}
      >
        {showDot && (
          <span
            className="shrink-0 rounded-full"
            style={{
              width: dotSize,
              height: dotSize,
              backgroundColor: dotColor,
            }}
          />
        )}
        <span className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
          {children}
        </span>
      </span>
    );
  },
);

Badge.displayName = "Badge";

export { Badge, badgeVariants, badgeColors };
export type { BadgeProps, BadgeColor, BadgeSize };
