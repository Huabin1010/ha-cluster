import { toast as sonner } from "sonner";
import { type PropsWithChildren } from "react";
import { Toaster } from "../components/ui/sonner";

export type BannerKind = "error" | "info" | "success";

type ToastAPI = {
  show: (message: string, kind?: BannerKind) => void;
  push: (kind: BannerKind, message: string) => void;
  clear: () => void;
};

function emit(kind: BannerKind, message: string) {
  if (kind === "success") sonner.success(message);
  else if (kind === "info") sonner.info(message);
  else sonner.error(message);
}

export function ToastProvider({ children }: PropsWithChildren) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}

export function useToast(): ToastAPI {
  return {
    show: (message, kind = "error") => emit(kind, message),
    push: (kind, message) => emit(kind, message),
    clear: () => sonner.dismiss(),
  };
}
