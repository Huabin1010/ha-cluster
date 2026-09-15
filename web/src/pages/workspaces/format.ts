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

export type CapacityPreview = {
  available: boolean;
  cluster_ok: boolean;
  budget_ok: boolean;
  fits: number;
  nodes: number;
  plan: string;
  arch: string;
  runtime: string;
  reason?: string;
  budget_reason?: string;
};

export function formatCapacityAvailable(p: CapacityPreview): string {
  const n = Number.isFinite(p.fits) ? p.fits : 0;
  return `${p.arch} · ${p.plan} 当前还可分配 ${n} 台`;
}

export function formatCapacityUnavailable(p: CapacityPreview): string {
  const parts: string[] = [];
  if (!p.cluster_ok) {
    parts.push(p.reason || `当前没有足够空闲的 ${p.arch} 节点能放下 ${p.plan}`);
  }
  if (!p.budget_ok) {
    parts.push(p.budget_reason || "超出项目预算，无法再开此规格");
  }
  if (parts.length === 0) {
    return `当前无法分配 ${p.arch} · ${p.plan}`;
  }
  return parts.join("。");
}
