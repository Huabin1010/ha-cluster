import { useId } from "react";
import { cn } from "@/lib/utils";

type HaLogoProps = {
  className?: string;
  size?: number;
  title?: string;
  /** inherit 跟随文字色；brand 用青绿渐变，适合深色登录英雄区 */
  tone?: "inherit" | "brand";
};

/**
 * ha-cluster 标志：六边形节点 + 三端织网。
 * 几何克制，16px 仍可辨，浅色/暗色都走 currentColor 或品牌渐变。
 */
export function HaLogo({ className, size = 28, title = "ha-cluster", tone = "inherit" }: HaLogoProps) {
  const uid = useId().replace(/:/g, "");
  const strokeId = `ha-stroke-${uid}`;
  const nodeId = `ha-node-${uid}`;
  const branded = tone === "brand";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {branded && (
        <defs>
          <linearGradient id={strokeId} x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7dd3fc" />
            <stop offset="100%" stopColor="#6ee7b7" />
          </linearGradient>
          <linearGradient id={nodeId} x1="12" y1="10" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
      )}
      <g
        fill="none"
        stroke={branded ? `url(#${strokeId})` : "currentColor"}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M16 3.6 L26.9 9.9 L26.9 22.1 L16 28.4 L5.1 22.1 L5.1 9.9 Z"
          strokeWidth="1.7"
        />
        <path d="M16 11.15 L11.35 19.45 L20.65 19.45 Z" strokeWidth="1.15" opacity={branded ? 0.9 : 0.55} />
      </g>
      <g fill={branded ? `url(#${nodeId})` : "currentColor"}>
        <circle cx="16" cy="11.15" r="1.85" />
        <circle cx="11.35" cy="19.45" r="1.85" />
        <circle cx="20.65" cy="19.45" r="1.85" />
        <circle cx="16" cy="16.7" r="1.15" opacity={branded ? 1 : 0.85} />
      </g>
    </svg>
  );
}

type HaBrandProps = {
  compact?: boolean;
  className?: string;
  tone?: HaLogoProps["tone"];
  wordmarkClassName?: string;
};

export function HaBrand({ compact = false, className, tone = "inherit", wordmarkClassName }: HaBrandProps) {
  return (
    <div
      data-testid="brand-logo"
      className={cn("inline-flex min-w-0 items-center gap-2", className)}
    >
      <HaLogo size={compact ? 28 : 26} tone={tone} className={tone === "inherit" ? "text-foreground" : undefined} />
      {!compact && (
        <span className={cn("truncate font-bold tracking-tight text-foreground", wordmarkClassName)}>
          ha-cluster
        </span>
      )}
    </div>
  );
}
