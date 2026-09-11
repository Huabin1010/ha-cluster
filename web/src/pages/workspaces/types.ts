export type Workspace = {
  id: string;
  name: string;
  plan: string;
  arch: string;
  status: string;
  project_id: string;
  visibility?: string;
  owner_user_id?: string;
  host_key_fp?: string;
  node_id?: string;
  node_name?: string;
  created_at?: string;
  cpu_milli?: number;
  mem_bytes?: number;
  disk_bytes?: number;
  pending_cpu_milli?: number;
  pending_mem_bytes?: number;
  pending_disk_bytes?: number;
  resize_status?: string;
  resize_kind?: string;
};

export type ProjectOption = {
  id: string;
  name: string;
  slug: string;
  my_role?: string;
  my_ssh_access?: string;
};

export type ProjectUsage = {
  project_id: string;
  workspaces: number;
  cpu_milli: number;
  mem_bytes: number;
  disk_bytes: number;
};

export const PLANS = ["nano", "small", "2c2g", "medium", "large", "xlarge"] as const;
export const ARCHES = ["amd64", "arm64"] as const;
export const CUSTOM_PLAN = "custom";
export const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

export const PLAN_SPECS: Record<string, string> = {
  nano: "0.5核 / 256MiB / 5GiB",
  small: "1核 / 512MiB / 5GiB",
  "2c2g": "2核 / 2GiB / 5GiB",
  medium: "2核 / 1GiB / 15GiB",
  large: "4核 / 2GiB / 20GiB",
  xlarge: "6核 / 3GiB / 30GiB",
};

export type PlanItem = {
  name: string;
  cpu_milli: number;
  mem_bytes: number;
  disk_bytes: number;
};

/** Fallback catalog when GET /plans is unavailable. */
export const PLAN_CATALOG: PlanItem[] = [
  { name: "nano", cpu_milli: 500, mem_bytes: 256 * MiB, disk_bytes: 5 * GiB },
  { name: "small", cpu_milli: 1000, mem_bytes: 512 * MiB, disk_bytes: 5 * GiB },
  { name: "2c2g", cpu_milli: 2000, mem_bytes: 2 * GiB, disk_bytes: 5 * GiB },
  { name: "medium", cpu_milli: 2000, mem_bytes: 1 * GiB, disk_bytes: 15 * GiB },
  { name: "large", cpu_milli: 4000, mem_bytes: 2 * GiB, disk_bytes: 20 * GiB },
  { name: "xlarge", cpu_milli: 6000, mem_bytes: 3 * GiB, disk_bytes: 30 * GiB },
];

export function formatCpuCores(cpuMilli: number): string {
  return (cpuMilli / 1000).toFixed(1).replace(/\.0$/, "") + "核";
}

export function formatMemSize(bytes: number): string {
  const mib = bytes / MiB;
  return mib >= 1024 ? `${(mib / 1024).toFixed(1).replace(/\.0$/, "")}GiB` : `${Math.round(mib)}MiB`;
}

export function formatDiskSize(bytes: number): string {
  const gib = bytes / GiB;
  return gib >= 1024 ? `${(gib / 1024).toFixed(1).replace(/\.0$/, "")}TiB` : `${Math.round(gib)}GiB`;
}

export function formatPlanSpec(plan: PlanItem): string {
  return `${formatCpuCores(plan.cpu_milli)} / ${formatMemSize(plan.mem_bytes)} / ${formatDiskSize(plan.disk_bytes)}`;
}

export function formatSpecNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toFixed(4)));
}

export function workspaceSpec(ws: Workspace): PlanItem | null {
  if (ws.cpu_milli && ws.mem_bytes && ws.disk_bytes) {
    return { name: ws.plan, cpu_milli: ws.cpu_milli, mem_bytes: ws.mem_bytes, disk_bytes: ws.disk_bytes };
  }
  return null;
}

export function pendingSpec(ws: Workspace): PlanItem | null {
  if (!hasPendingResize(ws) || !ws.pending_cpu_milli || !ws.pending_mem_bytes || !ws.pending_disk_bytes) {
    return null;
  }
  return {
    name: ws.plan,
    cpu_milli: ws.pending_cpu_milli,
    mem_bytes: ws.pending_mem_bytes,
    disk_bytes: ws.pending_disk_bytes,
  };
}

export function hasPendingResize(ws: Workspace): boolean {
  return ws.resize_status === "pending";
}

export function matchCatalogPlan(plans: PlanItem[], spec: Pick<PlanItem, "cpu_milli" | "mem_bytes" | "disk_bytes">): PlanItem | undefined {
  return plans.find(
    (p) => p.cpu_milli === spec.cpu_milli && p.mem_bytes === spec.mem_bytes && p.disk_bytes === spec.disk_bytes,
  );
}

export function defaultResizePlan(plans: PlanItem[], spec: PlanItem): string {
  const exact = matchCatalogPlan(plans, spec);
  if (exact) return exact.name;
  if (spec.name && plans.some((p) => p.name === spec.name)) return spec.name;
  return CUSTOM_PLAN;
}

export type ResizeDeltaKind = "up" | "down" | "same";
export type ResizePreviewKind = "upgrade" | "downgrade" | "unchanged" | "mixed" | "disk_shrink";

export type ResizePreview = {
  kind: ResizePreviewKind;
  cpu: ResizeDeltaKind;
  mem: ResizeDeltaKind;
  disk: ResizeDeltaKind;
};

function dimDelta(cur: number, next: number): ResizeDeltaKind {
  if (next > cur) return "up";
  if (next < cur) return "down";
  return "same";
}

export function classifyResizePreview(cur: PlanItem, target: PlanItem): ResizePreview {
  const cpu = dimDelta(cur.cpu_milli, target.cpu_milli);
  const mem = dimDelta(cur.mem_bytes, target.mem_bytes);
  const disk = dimDelta(cur.disk_bytes, target.disk_bytes);
  if (disk === "down") return { kind: "disk_shrink", cpu, mem, disk };
  const up = cpu === "up" || mem === "up" || disk === "up";
  const down = cpu === "down" || mem === "down";
  if (!up && !down) return { kind: "unchanged", cpu, mem, disk };
  if (up && down) return { kind: "mixed", cpu, mem, disk };
  if (up) return { kind: "upgrade", cpu, mem, disk };
  return { kind: "downgrade", cpu, mem, disk };
}

export function resizePreviewValid(kind: ResizePreviewKind): boolean {
  return kind === "upgrade" || kind === "downgrade";
}

export function isDestroyPending(ws: Workspace): boolean {
  return ws.status === "destroy_requested" || ws.status === "destroy_pending_platform";
}

export function isDestroyRequested(ws: Workspace): boolean {
  return ws.status === "destroy_requested";
}

export function isDestroyPendingPlatform(ws: Workspace): boolean {
  return ws.status === "destroy_pending_platform";
}

/** 状态中文映射（U4 验收） */
export const STATUS_LABEL: Record<string, string> = {
  requested: "待审批",
  provisioning: "开通中",
  running: "运行中",
  stopped: "已停止（仍占配额）",
  failed: "失败",
  rejected: "已拒绝",
  destroy_requested: "待销毁审批",
  destroy_pending_platform: "待平台终审",
  destroying: "销毁中",
  destroyed: "已销毁",
  node_lost: "节点丢失",
  fabric_degraded: "网络降级",
  suspended: "闲置休眠",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}

export type WorkspaceBadgeVariant = "ok" | "warn" | "danger" | "outline";

export function workspaceStatusVariant(status: string): WorkspaceBadgeVariant {
  if (status === "running") return "ok";
  if (
    status === "fabric_degraded" ||
    status === "requested" ||
    status === "suspended" ||
    status === "destroy_requested" ||
    status === "destroy_pending_platform" ||
    status === "provisioning"
  ) {
    return "warn";
  }
  if (status === "rejected" || status === "failed" || status === "node_lost") {
    return "danger";
  }
  return "outline";
}

/** 状态指示小圆点的颜色类，确保指示点颜色与业务状态严格同步 */
export function workspaceStatusDotClass(status: string): string {
  if (status === "running") return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]";
  if (
    status === "fabric_degraded" ||
    status === "requested" ||
    status === "suspended" ||
    status === "destroy_requested" ||
    status === "destroy_pending_platform" ||
    status === "provisioning"
  ) {
    return "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]";
  }
  if (status === "rejected" || status === "failed" || status === "node_lost") {
    return "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.45)]";
  }
  return "bg-muted-foreground/40";
}

export const badgeVariant = workspaceStatusVariant;

export function canApproveRole(projectRole?: string, platformRole?: string): boolean {
  if (platformRole === "platform_admin") return true;
  return projectRole === "owner" || projectRole === "admin";
}
