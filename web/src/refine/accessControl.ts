import type { AccessControlProvider } from "@refinedev/core";
import { authProvider, type AuthUser } from "@/providers";
import { canApproveDangerousOps, canManageNodes, canViewAudit, isPlatformAdmin } from "@/lib/permissions";

function adminOnly(role?: string, reason = "仅 platform_admin 可访问此页。") {
  return { can: isPlatformAdmin(role), reason };
}

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const me = (await authProvider.getIdentity()) as AuthUser | null;
    const role = me?.platform_role;

    if (resource === "audit-logs") {
      return {
        can: canViewAudit(role),
        reason: "仅 platform_admin / platform_ops 可访问此页。",
      };
    }

    if (resource === "nodes" || resource === "capacity") {
      return {
        can: canManageNodes(role),
        reason: "仅平台运维可访问节点与容量。",
      };
    }

    if (resource === "dangerous-approvals") {
      return {
        can: canApproveDangerousOps(role),
        reason: "仅平台超级管理员可终审危险操作。",
      };
    }

    if (resource === "docker-registries" || resource === "ingress-domains") {
      return adminOnly(role);
    }

    if (resource === "users") {
      return adminOnly(role, "仅 platform_admin 可管理平台用户。");
    }

    if (action === "reconcile") {
      return { can: isPlatformAdmin(role) };
    }

    return { can: true };
  },
};
