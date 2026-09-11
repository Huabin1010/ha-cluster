export const ASSIGNABLE_PLATFORM_ROLES = ["platform_user", "platform_ops", "platform_admin"] as const;

export function platformRoleLabel(role?: string): string {
  switch (role) {
    case "platform_admin":
      return "平台管理员";
    case "platform_ops":
      return "平台运维";
    case "platform_user":
      return "普通用户";
    default:
      return role || "—";
  }
}

export function userStatusLabel(status?: string): string {
  switch (status) {
    case "active":
      return "正常";
    case "suspended":
      return "已停用";
    case "deleted":
      return "已删除";
    default:
      return status || "—";
  }
}

export function matchesUserQuery(
  user: { username: string; email?: string; id?: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    user.username.toLowerCase().includes(needle) ||
    (user.email ?? "").toLowerCase().includes(needle) ||
    (user.id ?? "").toLowerCase().includes(needle)
  );
}
