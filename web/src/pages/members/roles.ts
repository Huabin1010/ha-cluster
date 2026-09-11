/** 项目角色：表单可选（不含 owner，owner 不可经此转让） */
export const ASSIGNABLE_ROLES = ["viewer", "developer", "admin"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_HELP: Record<string, string> = {
  viewer: "只读：可查看项目与 Workspace，不可 SSH / 建机 / 管成员",
  developer: "可申请服务器、SSH 进入已批准的隔离环境",
  admin: "可管成员与邀请，并具备 developer 能力",
  owner: "可改项目名称、slug 与预算，可删除项目；不可通过「添加成员」表单转让",
};

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
