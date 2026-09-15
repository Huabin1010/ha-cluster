/** 项目角色：表单可选（不含 owner，owner 不可经此转让） */
export const ASSIGNABLE_ROLES = ["viewer", "developer", "admin"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const MEMBER_ROLES = ["owner", "admin", "developer", "viewer"] as const;

export const MEMBER_SSH_FILTERS = ["granted", "pending", "none", "revoked"] as const;

export const ROLE_HELP: Record<string, string> = {
  owner: "可改项目名称、slug 与预算，可删除项目；默认可 SSH。不可通过「添加成员」表单转让。",
  admin: "可管成员、邀请与 SSH 授权，审批建机 / 升配 / 降配；默认可 SSH。",
  developer: "可申请服务器；获 SSH 授权后可进入已批准的隔离环境。",
  viewer: "只读：可查看项目与 Workspace，不可建机 / 管成员；默认无 SSH，可申请。",
};

export const SSH_HELP: { key: (typeof MEMBER_SSH_FILTERS)[number]; tip: string }[] = [
  { key: "granted", tip: "可打开网页终端或一键 SSH。只读模式能登录，但不能改工作区文件。" },
  { key: "pending", tip: "已提交申请，等待项目 owner / admin 批准。" },
  { key: "none", tip: "还不能连接工作区。developer / viewer 可申请，管理员也可直接授予。" },
  { key: "revoked", tip: "曾经有权，现已取消。需重新申请或由管理员再次授予。" },
];

export function roleLabel(role: string): string {
  const map: Record<string, string> = {
    viewer: "viewer（只读）",
    developer: "developer（开发）",
    admin: "admin（管理）",
    owner: "owner（所有者）",
  };
  return map[role] ?? role;
}

/** 列表/下拉短标签，与角色徽章文案一致 */
export function roleChipLabel(role: string): string {
  const map: Record<string, string> = {
    viewer: "观察者 (VIEWER)",
    developer: "开发者 (DEV)",
    admin: "管理员 (ADMIN)",
    owner: "所有者 (OWNER)",
  };
  return map[role] ?? role;
}

export function memberSshBucket(access?: string): (typeof MEMBER_SSH_FILTERS)[number] {
  if (access === "granted" || access === "pending" || access === "revoked") return access;
  return "none";
}

export function memberSshFilterLabel(access: string): string {
  switch (access) {
    case "granted":
      return "已授权";
    case "pending":
      return "待审批";
    case "revoked":
      return "已撤销";
    case "none":
      return "未开通";
    default:
      return access;
  }
}

export type MemberListFilters = {
  role: string;
  ssh: string;
};

export function matchesMemberFilters(
  member: { role: string; ssh_access?: string },
  filters: MemberListFilters,
): boolean {
  if (filters.role && filters.role !== "all" && member.role !== filters.role) {
    return false;
  }
  if (filters.ssh && filters.ssh !== "all" && memberSshBucket(member.ssh_access) !== filters.ssh) {
    return false;
  }
  return true;
}
