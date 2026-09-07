import { PropsWithChildren } from "react";
import { X } from "lucide-react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";

export type BannerKind = "error" | "info" | "success";

const variantMap: Record<BannerKind, "destructive" | "info" | "success"> = {
  error: "destructive",
  info: "info",
  success: "success",
};

type Props = PropsWithChildren<{
  kind?: BannerKind;
  onClose?: () => void;
  className?: string;
}>;

export function Banner({ kind = "error", onClose, className = "", children }: Props) {
  return (
    <Alert
      variant={variantMap[kind]}
      className={cn(className)}
      role={kind === "error" ? "alert" : "status"}
      data-testid="error-banner"
    >
      <AlertDescription className="banner-body">{children}</AlertDescription>
      {onClose && (
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="关闭" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </Alert>
  );
}
