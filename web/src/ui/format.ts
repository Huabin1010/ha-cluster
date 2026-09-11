/**
 * Unified resource, date, and clipboard formatting utilities.
 */

const Mi = 1024 * 1024;
const Gi = 1024 * Mi;

/**
 * Formats bytes to standard human readable string (B, KiB, MiB, GiB, TiB).
 */
export function formatBytes(n: number): string {
  if (!n || n <= 0) return "0";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // whole units: "1 KiB"; fractional under 10: "1.5 KiB"
  const num = Number.isInteger(v) || v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  return `${num} ${units[i]}`;
}

/**
 * Compact byte formatting for ops/node views (MiB/GiB only).
 */
export function fmtBytes(n: number): string {
  if (!n || n <= 0) return "0";
  if (n >= Gi) return (n / Gi).toFixed(1) + " Gi";
  return (n / Mi).toFixed(0) + " Mi";
}

/**
 * Formats milli-CPU (1000 = 1 core) to human readable string.
 */
export function formatCpuMilli(n: number): string {
  if (!n || n <= 0) return "0";
  if (n % 1000 === 0) return `${n / 1000} 核`;
  return `${n} mCPU`;
}

/**
 * Formats milli-CPU specifically in CPU cores (e.g. 1 核, 1.5 核).
 */
export function fmtCPU(milli: number): string {
  if (!milli || milli <= 0) return "0";
  if (milli % 1000 === 0) return (milli / 1000).toFixed(0) + " 核";
  return (milli / 1000).toFixed(1) + " 核";
}

/**
 * Formats project budget with fallback to '不限制'.
 */
export function formatBudget(n: number | undefined, kind: "cpu" | "bytes"): string {
  if (n == null || n === 0) return "不限制";
  return kind === "cpu" ? formatCpuMilli(n) : formatBytes(n);
}

/**
 * Formats ISO timestamp to locale string.
 */
export function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export const fmtTime = formatTime;

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "none";
  textarea.style.outline = "none";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  const selection = document.getSelection();
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    textarea.remove();
    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }
  }
  return ok;
}

/**
 * Copy text on both HTTPS and plain HTTP (LAN IPs).
 * `navigator.clipboard` is missing outside a secure context, so fall back to
 * a hidden textarea + `document.execCommand("copy")`.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* permissions / unfocused tab — try the legacy path */
    }
  }
  return legacyCopy(text);
}
