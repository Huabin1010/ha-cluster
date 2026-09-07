import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Banner, BannerKind } from "./Banner";

type ToastAPI = {
  /** show(message, kind?) — preferred for new code */
  show: (message: string, kind?: BannerKind) => void;
  /** push(kind, message) — used by ops pages */
  push: (kind: BannerKind, message: string) => void;
  clear: () => void;
};

const ToastContext = createContext<ToastAPI | null>(null);

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<{ message: string; kind: BannerKind } | null>(null);

  const show = useCallback((message: string, kind: BannerKind = "error") => {
    setToast({ message, kind });
  }, []);

  const push = useCallback((kind: BannerKind, message: string) => {
    setToast({ message, kind });
  }, []);

  const clear = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  const value = useMemo(() => ({ show, push, clear }), [show, push, clear]);

  return (
    <ToastContext.Provider value={value}>
      {toast && (
        <div className="toast-host" data-testid="toast-host">
          <Banner kind={toast.kind} onClose={clear}>
            {toast.message}
          </Banner>
        </div>
      )}
      {children}
    </ToastContext.Provider>
  );
}

/** Global ErrorBanner trigger for U2–U5 pages (`show` or `push`). */
export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
