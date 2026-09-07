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

export function formatCpuMilli(n: number): string {
  if (!n || n <= 0) return "0";
  if (n % 1000 === 0) return `${n / 1000} 核`;
  return `${n} mCPU`;
}

export function formatBudget(n: number | undefined, kind: "cpu" | "bytes"): string {
  if (n == null || n === 0) return "不限制";
  return kind === "cpu" ? formatCpuMilli(n) : formatBytes(n);
}

export function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
