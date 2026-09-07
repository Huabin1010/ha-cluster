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

export function formatUsageHint(u: {
  workspaces: number;
  cpu_milli: number;
  mem_bytes: number;
  disk_bytes: number;
}): string {
  return `当前已用：${u.workspaces} 台 · CPU ${fmtCPU(u.cpu_milli)} · 内存 ${fmtBytes(u.mem_bytes)} · 磁盘 ${fmtBytes(u.disk_bytes)}（停止的实例仍计入）`;
}
