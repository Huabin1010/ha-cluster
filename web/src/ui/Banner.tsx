import { PropsWithChildren } from "react";

export type BannerKind = "error" | "info" | "success";

type Props = PropsWithChildren<{
  kind?: BannerKind;
  onClose?: () => void;
  className?: string;
}>;

export function Banner({ kind = "error", onClose, className = "", children }: Props) {
  return (
    <div
      className={`banner banner-${kind} ${className}`.trim()}
      role={kind === "error" ? "alert" : "status"}
      data-testid="error-banner"
    >
      <span className="banner-body">{children}</span>
      {onClose && (
        <button type="button" className="ghost banner-close" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}
