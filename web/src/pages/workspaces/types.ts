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
  cpu_milli?: number;
  mem_bytes?: number;
  disk_bytes?: number;
  pending_cpu_milli?: number;
  pending_mem_bytes?: number;
  pending_disk_bytes?: number;
  resize_status?: string;
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

export const PLAN_SPECS: Record<string, string> = {
  nano: "0.5核 / 256MiB / 5GiB",
  small: "1核 / 512MiB / 10GiB",
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

export function formatPlanSpec(plan: PlanItem): string {
  const cpu = (plan.cpu_milli / 1000).toFixed(1).replace(/\.0$/, "") + "核";
  const mib = plan.mem_bytes / (1024 * 1024);
  const mem = mib >= 1024 ? `${(mib / 1024).toFixed(1).replace(/\.0$/, "")}GiB` : `${Math.round(mib)}MiB`;
  const gib = plan.disk_bytes / (1024 * 1024 * 1024);
  const disk = gib >= 1024 ? `${(gib / 1024).toFixed(1).replace(/\.0$/, "")}TiB` : `${Math.round(gib)}GiB`;
  return `${cpu} / ${mem} / ${disk}`;
}

export function workspaceSpec(ws: Workspace): PlanItem | null {
  if (ws.cpu_milli && ws.mem_bytes && ws.disk_bytes) {
    return { name: ws.plan, cpu_milli: ws.cpu_milli, mem_bytes: ws.mem_bytes, disk_bytes: ws.disk_bytes };
  }
  return null;
}

export function hasPendingResize(ws: Workspace): boolean {
  return ws.resize_status === "pending";
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

export const GiB = 1024 * 1024 * 1024;

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

export function canApproveRole(projectRole?: string, platformRole?: string): boolean {
  if (platformRole === "platform_admin") return true;
  return projectRole === "owner" || projectRole === "admin";
}
