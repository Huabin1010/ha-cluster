const Mi = 1024 * 1024;
const Gi = 1024 * Mi;

export function fmtBytes(n: number): string {
  if (!n) return "0";
  if (n >= Gi) return (n / Gi).toFixed(1) + " Gi";
  return (n / Mi).toFixed(0) + " Mi";
}

export function fmtCPU(milli: number): string {
  if (!milli) return "0";
  if (milli % 1000 === 0) return (milli / 1000).toFixed(0) + " 核";
  return (milli / 1000).toFixed(1) + " 核";
}

export function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
