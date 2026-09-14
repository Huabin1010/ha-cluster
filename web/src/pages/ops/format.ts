import { isPlatformAdmin, isPlatformStaff } from "@/lib/permissions";
import { fmtBytes, fmtCPU, fmtTime } from "@/ui/format";

export { fmtBytes, fmtCPU, fmtTime };

/** 审计操作中文映射 */
export const ACTION_LABEL: Record<string, string> = {
  "user.register": "用户注册",
  "user.login": "用户登录",
  "user.create": "创建用户",
  "user.suspend": "停用用户",
  "user.unsuspend": "恢复用户",
  "user.password_reset": "重置用户密码",
  "user.role_change": "变更平台角色",
  "user.delete": "删除用户",
  "member.add": "添加成员",
  "membership.update": "更新成员权限",
  "project.create": "创建项目",
  "project.update": "更新项目",
  "project.delete": "删除项目",
  "project.transfer_ownership": "转让项目所有权",
  "workspace.create": "开通服务器",
  "workspace.request": "申请服务器",
  "workspace.approve": "批准服务器",
  "workspace.reject": "拒绝服务器申请",
  "workspace.resize.request": "申请扩容",
  "workspace.resize.approve": "批准扩容",
  "workspace.resize.reject": "驳回扩容",
  "workspace.destroy.request": "申请销毁服务器",
  "workspace.destroy.approve_project": "项目通过销毁",
  "workspace.destroy": "销毁服务器",
  "workspace.idle_suspend": "闲置挂起服务器",
  "workspace.start": "启动服务器",
  "workspace.stop": "停止服务器",
  "ingress.create": "接入域名",
  "ingress.delete": "移除域名",
  "ingress.approve": "批准域名",
  "ingress.reject": "驳回域名",
  "ingress_domain_zone.create": "添加域名分区",
  "ingress_domain_zone.update": "更新域名分区",
  "ingress_domain_zone.delete": "删除域名分区",
  "invite.create": "创建邀请",
  "ssh.allow": "SSH 放行",
  "ssh.deny": "SSH 拒绝",
  "ssh.exec": "SSH 执行命令",
  "ssh.exec.deny": "SSH 执行失败",
  "k8s.apply": "应用 K8s 清单",
  "k8s.apply.deny": "K8s 清单被拒绝",
  "k8s.delete": "删除 K8s 资源",
  "kubeconfig.download": "下载 kubeconfig",
  "ssh.session.open": "打开网页终端",
  "ssh.session.close": "关闭网页终端",
  "ssh_access.request": "申请 SSH 权限",
  "ssh_access.grant": "授予 SSH 权限",
  "docker_registry.create": "添加镜像仓库",
  "docker_registry.delete": "删除镜像仓库",
  "node.join_token_issued": "签发节点加入令牌",
  "agent_token.issue": "签发 Agent 令牌",
  "tls.issue": "签发 TLS 证书",
};

/** 审计资源类型中文映射 */
export const RESOURCE_LABEL: Record<string, string> = {
  user: "用户",
  project: "项目",
  workspace: "服务器",
  invitation: "邀请",
  membership: "成员",
  ssh_key: "SSH 公钥",
  node: "节点",
  cluster: "集群",
  ingress: "域名路由",
  ingress_domain_zone: "域名分区",
  docker_registry: "镜像仓库",
  tls_cert: "TLS 证书",
};

export function actionLabel(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  const keys = Object.keys(ACTION_LABEL).sort((a, b) => b.length - a.length);
  const prefix = keys.find((key) => action === key || action.startsWith(`${key}.`));
  return prefix ? ACTION_LABEL[prefix] : action;
}

export function resourceTypeLabel(type?: string): string {
  if (!type) return "—";
  return RESOURCE_LABEL[type] || type;
}

export function shortId(id?: string): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function resourceLabel(type?: string, id?: string): string {
  const kind = resourceTypeLabel(type);
  if (!id) return kind;
  return `${kind}:${shortId(id)}`;
}

export type AuditMeta = Record<string, unknown>;

function metaStr(meta: AuditMeta | undefined, key: string): string {
  if (!meta) return "";
  const v = meta[key];
  if (v == null || v === "") return "";
  return String(v);
}

function metaNum(meta: AuditMeta | undefined, key: string): number | undefined {
  if (!meta) return undefined;
  const v = meta[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function compactRole(role: string): string {
  const map: Record<string, string> = {
    viewer: "观察者",
    developer: "开发者",
    admin: "管理员",
    owner: "所有者",
  };
  return map[role] || role;
}

function compactSSH(access: string, mode?: string): string {
  if (access === "granted") {
    if (mode === "read_only") return "已授权 · 只读";
    if (mode === "read_write") return "已授权 · 读写";
    return "已授权";
  }
  const map: Record<string, string> = {
    none: "未开通",
    pending: "待审批",
    revoked: "已撤销",
  };
  return map[access] || access || "未开通";
}

function specLine(cpu?: number, mem?: number, disk?: number): string {
  const bits = [cpu ? fmtCPU(cpu) : "", mem ? fmtBytes(mem) : "", disk ? fmtBytes(disk) : ""].filter(Boolean);
  return bits.join(" / ");
}

/** 资源列名称：优先接口回填 / 项目名 / 用户名 / 工作区名 / 域名，否则短 ID */
export function auditResourceName(type?: string, id?: string, meta?: AuditMeta, resolved?: string): string {
  const live = resolved?.trim();
  if (live) return live;
  if (type === "project") {
    const name = metaStr(meta, "project_name") || metaStr(meta, "name");
    if (name) return name;
  } else if (type === "membership" || type === "user") {
    const name =
      metaStr(meta, "target_display_name") ||
      metaStr(meta, "display_name") ||
      metaStr(meta, "target_username") ||
      metaStr(meta, "username");
    if (name) return name;
  } else if (type === "workspace") {
    // SSH/exec meta 常带操作人 username；k8s 删除还会带对象 name。二者都不是服务器名。
    const name = metaStr(meta, "workspace_name");
    if (name) return name;
  } else if (type === "ingress") {
    const name = metaStr(meta, "domain");
    if (name) return name;
  } else if (type === "node") {
    const name = metaStr(meta, "node") || metaStr(meta, "name");
    if (name) return name;
  }
  if (type !== "workspace") {
    const fallback = metaStr(meta, "project_name") || metaStr(meta, "workspace_name") || metaStr(meta, "name");
    if (fallback) return fallback;
  }
  return shortId(id);
}

/** 列表里的真实名称优先；接口回填若只是操作人 username，不当作服务器名 */
export function auditPreferredName(
  type?: string,
  meta?: AuditMeta,
  liveName?: string,
  apiName?: string,
): string | undefined {
  const live = liveName?.trim();
  if (live) return live;
  const api = apiName?.trim();
  if (!api) return undefined;
  if (type === "workspace") {
    const actorUser = metaStr(meta, "username");
    const wsName = metaStr(meta, "workspace_name");
    if (actorUser && api === actorUser && wsName !== api) return undefined;
  }
  return api;
}

export type AuditCopyFields = {
  id: number;
  created_at: string;
  actor_user_id: string;
  actor_username?: string;
  actor_display_name?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip?: string;
  meta?: AuditMeta;
};

/** 一行审计日志的排查文本：ID、时间、操作人、动作、资源、IP */
export function auditCopySnippet(log: AuditCopyFields, resourceName: string): string {
  const actor = auditActorLabel(log.actor_display_name, log.actor_username, log.actor_user_id);
  const actorLine =
    log.actor_username && log.actor_username !== actor ? `${actor} (${log.actor_username})` : actor;
  const lines = [
    `ID: ${log.id}`,
    `触发时间: ${fmtTime(log.created_at)}`,
    `操作人: ${actorLine}`,
    `安全动作: ${actionLabel(log.action)} (${log.action})`,
    `资源: ${resourceTypeLabel(log.resource_type)} ${resourceName}`.trim(),
    `资源 ID: ${log.resource_id}`,
    `来源 IP: ${log.ip?.trim() || "—"}`,
  ];
  const detail = auditChangeSummary(log.action, log.meta);
  if (detail) lines.push(`详情: ${detail}`);
  return lines.join("\n");
}

export function auditResourceTitle(type?: string, id?: string, meta?: AuditMeta, resolved?: string): string {
  return `${resourceTypeLabel(type)} ${auditResourceName(type, id, meta, resolved)}`.trim();
}

export function auditActorLabel(displayName?: string, username?: string, id?: string): string {
  return displayName?.trim() || username?.trim() || shortId(id);
}

export type AuditResourceLinkCtx = {
  userId?: string;
  platformRole?: string;
  visibleWorkspaceIds?: Iterable<string>;
  visibleProjectIds?: Iterable<string>;
};

function hasId(ids: Iterable<string> | undefined, id?: string): boolean {
  if (!id || !ids) return false;
  if (ids instanceof Set) return ids.has(id);
  for (const item of ids) {
    if (item === id) return true;
  }
  return false;
}

/** 审计资源详情路径：无对应控制台页时返回空串 */
export function auditResourceHref(type?: string, id?: string, meta?: AuditMeta): string {
  switch (type) {
    case "workspace":
      return id ? `/workspaces/${id}` : "";
    case "project":
      return id ? `/projects/${id}` : "";
    case "membership": {
      const pid = metaStr(meta, "project_id");
      return pid ? `/projects/${pid}/members` : "";
    }
    case "user":
      return id ? `/users?q=${encodeURIComponent(id)}` : "/users";
    case "node":
    case "cluster":
      return "/nodes";
    case "ingress": {
      const ws = metaStr(meta, "workspace");
      return ws ? `/workspaces/${ws}/ingress` : "";
    }
    case "ingress_domain_zone":
    case "tls_cert":
      return "/ingress-domains";
    case "docker_registry":
      return "/docker-registries";
    case "ssh_key":
      return "/settings/keys";
    default:
      return "";
  }
}

/** 平台管理员可进任意详情；其他人仅自己的或已加入的项目/服务器 */
export function canOpenAuditResource(
  type: string | undefined,
  id: string | undefined,
  meta: AuditMeta | undefined,
  ctx: AuditResourceLinkCtx,
): boolean {
  if (!auditResourceHref(type, id, meta)) return false;
  const admin = isPlatformAdmin(ctx.platformRole);
  const staff = isPlatformStaff(ctx.platformRole);
  const self = Boolean(ctx.userId && id && ctx.userId === id);

  switch (type) {
    case "workspace":
      return admin || hasId(ctx.visibleWorkspaceIds, id);
    case "project":
      return admin || hasId(ctx.visibleProjectIds, id);
    case "membership": {
      const pid = metaStr(meta, "project_id");
      return admin || hasId(ctx.visibleProjectIds, pid) || self;
    }
    case "user":
      return admin;
    case "node":
    case "cluster":
      return staff;
    case "ingress": {
      const ws = metaStr(meta, "workspace");
      return admin || hasId(ctx.visibleWorkspaceIds, ws);
    }
    case "ingress_domain_zone":
    case "docker_registry":
    case "tls_cert":
      return admin;
    case "ssh_key":
      return admin || self;
    default:
      return false;
  }
}

/** 资源列第二行：扩容从 A→B、权限从 xx→xx 等变更摘要 */
export function auditChangeSummary(action: string, meta?: AuditMeta): string {
  if (!meta) return "";
  const parts: string[] = [];

  const fromRole = metaStr(meta, "from_role");
  const toRole = metaStr(meta, "to_role");
  if (fromRole && toRole && fromRole !== toRole) {
    parts.push(`角色 ${compactRole(fromRole)} → ${compactRole(toRole)}`);
  }

  const fromSSH = metaStr(meta, "from_ssh_access") || (metaStr(meta, "to_ssh_access") ? "none" : "");
  const toSSH = metaStr(meta, "to_ssh_access");
  const fromMode = metaStr(meta, "from_ssh_mode");
  const toMode = metaStr(meta, "to_ssh_mode");
  if (fromSSH && toSSH && (fromSSH !== toSSH || fromMode !== toMode)) {
    parts.push(`SSH ${compactSSH(fromSSH, fromMode)} → ${compactSSH(toSSH, toMode)}`);
  }

  const fromUser = metaStr(meta, "from_username");
  const toUser = metaStr(meta, "to_username");
  if (fromUser && toUser && fromUser !== toUser) {
    parts.push(`所有者 ${fromUser} → ${toUser}`);
  }

  const fromSpec = specLine(
    metaNum(meta, "from_cpu_milli"),
    metaNum(meta, "from_mem_bytes"),
    metaNum(meta, "from_disk_bytes"),
  );
  const toSpec = specLine(
    metaNum(meta, "to_cpu_milli"),
    metaNum(meta, "to_mem_bytes"),
    metaNum(meta, "to_disk_bytes"),
  );
  if (fromSpec && toSpec && fromSpec !== toSpec) {
    const kind = metaStr(meta, "kind");
    const kindLabel = kind === "upgrade" ? "升配" : kind === "downgrade" ? "降配" : action.includes("resize") ? "规格" : "";
    parts.push(kindLabel ? `${kindLabel} ${fromSpec} → ${toSpec}` : `${fromSpec} → ${toSpec}`);
  } else {
    const spec = specLine(metaNum(meta, "cpu_milli"), metaNum(meta, "mem_bytes"), metaNum(meta, "disk_bytes"));
    const plan = metaStr(meta, "plan");
    const arch = metaStr(meta, "arch");
    const node = metaStr(meta, "node");
    const bits = [plan, arch, spec, node ? `节点 ${node}` : ""].filter(Boolean);
    if (bits.length) parts.push(bits.join(" · "));
  }

  const domain = metaStr(meta, "domain");
  if (domain && action.includes("ingress")) {
    // 标题已展示域名时不再重复
    if (metaStr(meta, "workspace")) parts.push(`工作区 ${shortId(metaStr(meta, "workspace"))}`);
  }

  const command = metaStr(meta, "command");
  if (command && action.startsWith("ssh.exec")) {
    parts.push(command);
  }

  const reason = metaStr(meta, "reason") || (action.includes("deny") ? metaStr(meta, "error") : "");
  if (reason) parts.push(`原因：${reason}`);

  return parts.join(" · ");
}

export type AuditEvent = {
  actor_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  resource_name?: string;
  created_at: string;
};

export function findLastLogin(logs: AuditEvent[], userId: string): string {
  return logs.find((l) => l.actor_user_id === userId && l.action === "user.login")?.created_at ?? "";
}

export function findLastAction(logs: AuditEvent[], userId: string): AuditEvent | undefined {
  return logs.find((l) => l.actor_user_id === userId);
}

export function recentLogsForResource(logs: AuditEvent[], resourceId: string, limit = 3): AuditEvent[] {
  if (!resourceId) return [];
  const out: AuditEvent[] = [];
  for (const l of logs) {
    if (l.resource_id !== resourceId) continue;
    out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}

export function uniqueResourceNames(
  logs: AuditEvent[],
  userId: string,
  type: string,
  resolveName?: (id: string) => string,
  limit = 4,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const l of logs) {
    if (l.actor_user_id !== userId || l.resource_type !== type || !l.resource_id) continue;
    if (seen.has(l.resource_id)) continue;
    seen.add(l.resource_id);
    const name = resolveName?.(l.resource_id) || l.resource_name?.trim() || shortId(l.resource_id);
    if (name) names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}
