export type ProjectRole = "owner" | "admin" | "developer" | "viewer";
export type SSHAccess = "none" | "pending" | "granted" | "revoked";

export function isPlatformStaff(platformRole?: string) {
  return platformRole === "platform_admin" || platformRole === "platform_ops";
}

export function isPlatformAdmin(platformRole?: string) {
  return platformRole === "platform_admin";
}

export function canManageNodes(platformRole?: string) {
  return isPlatformStaff(platformRole);
}

export function canViewAudit(platformRole?: string) {
  return isPlatformStaff(platformRole);
}

export function canManageMembers(myRole?: string, platformRole?: string) {
  if (isPlatformAdmin(platformRole)) return true;
  return myRole === "owner" || myRole === "admin";
}

export function canApproveWorkspace(myRole?: string, platformRole?: string) {
  return canManageMembers(myRole, platformRole);
}

export function canSSH(myRole?: string, sshAccess?: string, platformRole?: string) {
  if (isPlatformAdmin(platformRole)) return true;
  if (myRole === "owner" || myRole === "admin") return true;
  return sshAccess === "granted";
}

export function sshAccessLabel(access?: string) {
  switch (access) {
    case "granted":
      return "已授权";
    case "pending":
      return "待审批";
    case "revoked":
      return "已撤销";
    default:
      return "无";
  }
}
