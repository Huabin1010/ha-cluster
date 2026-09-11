export {
  fmtBytes,
  fmtCPU,
  fmtTime,
} from "@/ui/format";

/** 审计操作中文映射 */
export const ACTION_LABEL: Record<string, string> = {
  "user.register": "用户注册",
  "user.login": "用户登录",
  "project.create": "创建项目",
  "project.update": "更新项目",
  "project.delete": "删除项目",
  "workspace.create": "开通服务器",
  "workspace.request": "申请服务器",
  "workspace.approve": "批准服务器",
  "workspace.reject": "拒绝服务器申请",
  "workspace.resize.request": "申请扩容",
  "workspace.resize.approve": "批准扩容",
  "ingress.create": "接入域名",
  "ingress.delete": "移除域名",
  "ingress.approve": "批准域名",
  "ingress.reject": "驳回域名",
  "invite.create": "创建邀请",
  "ssh.allow": "SSH 放行",
  "ssh.deny": "SSH 拒绝",
  "ssh.session.open": "SSH 会话开始",
  "ssh.session.close": "SSH 会话断开",
};

/** 审计资源类型中文映射 */
export const RESOURCE_LABEL: Record<string, string> = {
  user: "用户",
  project: "项目",
  workspace: "服务器",
  invitation: "邀请",
  ssh_key: "SSH 公钥",
  node: "节点",
  ingress: "域名路由",
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
