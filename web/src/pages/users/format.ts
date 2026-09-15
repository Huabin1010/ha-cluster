export const ASSIGNABLE_PLATFORM_ROLES = ["platform_user", "platform_ops", "platform_admin"] as const;

export const USER_STATUS_FILTERS = ["active", "suspended"] as const;

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
      return "禁用";
    case "deleted":
      return "已删除";
    default:
      return status || "—";
  }
}

export function matchesUserQuery(
  user: { username: string; display_name?: string; email?: string; id?: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    user.username.toLowerCase().includes(needle) ||
    (user.display_name ?? "").toLowerCase().includes(needle) ||
    (user.email ?? "").toLowerCase().includes(needle) ||
    (user.id ?? "").toLowerCase().includes(needle)
  );
}

export type UserListFilters = {
  role: string;
  status: string;
  projectId: string;
};

export function matchesUserFilters(
  user: {
    platform_role?: string;
    status?: string;
    projects?: Array<{ id: string }>;
  },
  filters: UserListFilters,
): boolean {
  if (filters.role && filters.role !== "all" && (user.platform_role || "platform_user") !== filters.role) {
    return false;
  }
  if (filters.status && filters.status !== "all" && (user.status || "active") !== filters.status) {
    return false;
  }
  if (filters.projectId === "none") {
    return !user.projects || user.projects.length === 0;
  }
  if (filters.projectId && filters.projectId !== "all") {
    return (user.projects ?? []).some((p) => p.id === filters.projectId);
  }
  return true;
}
