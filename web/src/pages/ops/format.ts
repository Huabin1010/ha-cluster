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
  "invite.create": "创建邀请",
  "ssh.allow": "SSH 放行",
  "ssh.deny": "SSH 拒绝",
  "ssh.session.open": "打开网页终端",
  "ssh.session.close": "关闭网页终端",
  "ssh_access.request": "申请 SSH 权限",
  "ssh_access.grant": "授予 SSH 权限",
  "docker_registry.create": "添加镜像仓库",
  "docker_registry.delete": "删除镜像仓库",
  "node.join_token_issued": "签发节点加入令牌",
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
  ingress: "域名路由",
  docker_registry: "镜像仓库",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] || action;
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

/** 资源列名称：优先用户名 / 工作区名 / 域名，否则短 ID */
export function auditResourceName(type?: string, id?: string, meta?: AuditMeta): string {
  if (type === "membership" || type === "user") {
    const name = metaStr(meta, "target_username") || metaStr(meta, "username");
    if (name) return name;
  } else if (type === "workspace") {
    const name = metaStr(meta, "workspace_name");
    if (name) return name;
  } else if (type === "ingress") {
    const name = metaStr(meta, "domain");
    if (name) return name;
  }
  return shortId(id);
}

export function auditResourceTitle(type?: string, id?: string, meta?: AuditMeta): string {
  return `${resourceTypeLabel(type)} ${auditResourceName(type, id, meta)}`.trim();
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

  const reason = metaStr(meta, "reason");
  if (reason) parts.push(`原因：${reason}`);

  return parts.join(" · ");
}
