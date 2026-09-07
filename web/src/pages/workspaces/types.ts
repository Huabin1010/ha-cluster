export type Workspace = {
  id: string;
  name: string;
  plan: string;
  arch: string;
  status: string;
  project_id: string;
  visibility?: string;
};

export type ProjectOption = {
  id: string;
  name: string;
  slug: string;
};

export type ProjectUsage = {
  project_id: string;
  workspaces: number;
  cpu_milli: number;
  mem_bytes: number;
  disk_bytes: number;
};

export const PLANS = ["nano", "small", "medium", "large", "xlarge"] as const;
export const ARCHES = ["amd64", "arm64"] as const;

/** 状态中文映射（U4 验收） */
export const STATUS_LABEL: Record<string, string> = {
  requested: "请求中",
  provisioning: "创建中",
  running: "运行中",
  stopped: "已停止（仍占配额）",
  failed: "失败",
  destroying: "销毁中",
  destroyed: "已销毁",
  node_lost: "节点丢失",
  fabric_degraded: "网络降级",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}
