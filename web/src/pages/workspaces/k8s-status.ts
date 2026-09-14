export type K8sReplicaCounts = {
  desired: number;
  ready: number;
  updated?: number;
  available?: number;
  unavailable?: number;
  current?: number;
};

export type K8sResource = {
  kind: string;
  name: string;
  namespace: string;
  labels?: Record<string, string>;
  phase?: string;
  ready?: string;
  replicas?: K8sReplicaCounts;
  reason?: string;
  message?: string;
  restarts?: number;
  images?: string[];
  strategy?: string;
  max_unavailable?: string;
  max_surge?: string;
  owner_kind?: string;
  owner_name?: string;
  created_at?: string;
  missing_requests?: boolean;
};

export type K8sQuota = {
  name: string;
  hard?: Record<string, string>;
  used?: Record<string, string>;
};

export type K8sDeployment = {
  name: string;
  namespace: string;
  labels?: Record<string, string>;
  replicas: number;
  ready_replicas: number;
  updated_replicas: number;
  available_replicas: number;
  unavailable_replicas: number;
  generation: number;
  observed_generation: number;
  strategy?: string;
  max_unavailable?: string;
  max_surge?: string;
  images?: string[];
  rolling: boolean;
  missing_requests?: boolean;
};

export type K8sReplicaSet = {
  name: string;
  namespace: string;
  owner?: string;
  labels?: Record<string, string>;
  desired: number;
  current: number;
  ready: number;
  generation?: number;
  images?: string[];
  active?: boolean;
};

export type K8sPod = {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
  restarts: number;
  labels?: Record<string, string>;
  reason?: string;
  message?: string;
  node?: string;
  owner_kind?: string;
  owner_name?: string;
  images?: string[];
  created_at?: string;
  requests?: Record<string, string>;
};

export type K8sService = {
  name: string;
  namespace: string;
  type?: string;
  cluster_ip?: string;
  ports?: string[];
  labels?: Record<string, string>;
};

export type K8sEvent = {
  type: string;
  reason: string;
  message: string;
  object_kind?: string;
  object_name?: string;
  count?: number;
  last_seen?: string;
  stale?: boolean;
};

export type K8sNamespaceStatus = {
  namespace: string;
  summary: {
    deployments: number;
    ready_deployments: number;
    replica_sets: number;
    pods: number;
    running_pods: number;
    pending_pods: number;
    failed_pods: number;
    warnings: number;
  };
  quota?: K8sQuota | null;
  deployments: K8sDeployment[];
  replica_sets: K8sReplicaSet[];
  pods: K8sPod[];
  services: K8sService[];
  events: K8sEvent[];
  warnings: string[];
  history: string[];
  resources: K8sResource[];
};

export function podPhaseLabel(phase: string): string {
  switch (phase) {
    case "Running":
      return "运行中";
    case "Pending":
      return "等待中";
    case "Failed":
      return "失败";
    case "Succeeded":
      return "已完成";
    case "Unknown":
      return "未知";
    default:
      return phase || "—";
  }
}

export function podPhaseVariant(phase: string, ready?: boolean): "ok" | "warn" | "danger" | "outline" {
  switch (phase) {
    case "Running":
      return ready === false ? "warn" : "ok";
    case "Pending":
      return "warn";
    case "Failed":
    case "Unknown":
      return "danger";
    default:
      return "outline";
  }
}

export function replicaText(ready: number, desired: number): string {
  return `${ready}/${desired}`;
}

export function releaseLabel(labels?: Record<string, string>): string {
  if (!labels) return "";
  return labels.release || labels.version || "";
}

export function replicaSetActive(rs: K8sReplicaSet): boolean {
  if (typeof rs.active === "boolean") return rs.active;
  return rs.desired > 0 || rs.current > 0 || rs.ready > 0;
}

export function currentRelease(sets: K8sReplicaSet[]): string {
  const active = sets.find(replicaSetActive);
  return releaseLabel(active?.labels) || releaseLabel(sets[0]?.labels);
}

export function strategyLabel(d: {
  strategy?: string;
  max_unavailable?: string;
  max_surge?: string;
}): string {
  const raw = d.strategy || "RollingUpdate";
  const name = raw === "RollingUpdate" ? "滚动更新" : raw;
  const bits = [name];
  if (d.max_unavailable != null && d.max_unavailable !== "") bits.push(`不可用 ${d.max_unavailable}`);
  if (d.max_surge != null && d.max_surge !== "") bits.push(`额外 ${d.max_surge}`);
  return bits.join(" · ");
}

export function eventIsStale(ev: K8sEvent, sets: K8sReplicaSet[]): boolean {
  if (ev.stale) return true;
  if (ev.type && ev.type !== "Warning") return true;
  if ((ev.object_kind || "").toLowerCase() !== "replicaset") return !!ev.stale;
  const rs = sets.find((item) => item.name === ev.object_name);
  return !rs || !replicaSetActive(rs);
}

function fmtQuotaMem(v?: string): string {
  if (!v) return "0";
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n >= 1 << 30) return `${n / (1 << 30)}Gi`;
    if (n >= 1 << 20) return `${Math.round(n / (1 << 20))}Mi`;
  }
  return v;
}

export function quotaLine(hard?: Record<string, string>, used?: Record<string, string>): string {
  if (!hard) return "";
  const parts: string[] = [];
  if (hard["requests.cpu"]) parts.push(`CPU ${used?.["requests.cpu"] || "0"} / ${hard["requests.cpu"]}`);
  if (hard["requests.memory"]) {
    parts.push(`内存 ${fmtQuotaMem(used?.["requests.memory"])} / ${fmtQuotaMem(hard["requests.memory"])}`);
  }
  if (hard.pods) parts.push(`Pod ${used?.pods || "0"} / ${hard.pods}`);
  return parts.join(" · ");
}

export function emptyK8sStatus(namespace = ""): K8sNamespaceStatus {
  return {
    namespace,
    summary: {
      deployments: 0,
      ready_deployments: 0,
      replica_sets: 0,
      pods: 0,
      running_pods: 0,
      pending_pods: 0,
      failed_pods: 0,
      warnings: 0,
    },
    deployments: [],
    replica_sets: [],
    pods: [],
    services: [],
    events: [],
    warnings: [],
    history: [],
    resources: [],
  };
}
