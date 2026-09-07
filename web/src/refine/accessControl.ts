import type { AccessControlProvider } from "@refinedev/core";
import { authProvider, type AuthUser } from "../providers";

function isOps(role?: string) {
  return role === "platform_admin" || role === "platform_ops";
}

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const me = (await authProvider.getIdentity()) as AuthUser | null;
    const role = me?.platform_role;

    if (resource === "audit-logs") {
      return {
        can: isOps(role),
        reason: "仅 platform_admin / platform_ops 可访问此页。",
      };
    }

    if (action === "reconcile") {
      return { can: role === "platform_admin" };
    }

    return { can: true };
  },
};
