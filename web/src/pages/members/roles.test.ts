import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  MEMBER_ROLES,
  ROLE_HELP,
  SSH_HELP,
  matchesMemberFilters,
  memberSshBucket,
  memberSshFilterLabel,
  roleChipLabel,
  roleLabel,
} from "./roles";

describe("member roles", () => {
  it("does not allow assigning owner via form roles", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
    expect([...ASSIGNABLE_ROLES]).toEqual(["viewer", "developer", "admin"]);
  });

  it("documents all four roles in Chinese help", () => {
    expect(ROLE_HELP.viewer).toMatch(/只读/);
    expect(ROLE_HELP.developer).toMatch(/SSH|Workspace|申请/);
    expect(ROLE_HELP.admin).toMatch(/成员/);
    expect(ROLE_HELP.owner).toMatch(/预算/);
    expect(MEMBER_ROLES).toEqual(["owner", "admin", "developer", "viewer"]);
    expect(SSH_HELP.map((item) => item.key)).toEqual(["granted", "pending", "none", "revoked"]);
  });

  it("labels known roles", () => {
    expect(roleLabel("viewer")).toContain("只读");
    expect(roleLabel("owner")).toContain("所有者");
    expect(roleLabel("custom")).toBe("custom");
  });

  it("uses short chip labels in the member table", () => {
    expect(roleChipLabel("developer")).toBe("开发者 (DEV)");
    expect(roleChipLabel("admin")).toBe("管理员 (ADMIN)");
  });

  it("filters members by project role and SSH access", () => {
    const owner = { role: "owner", ssh_access: "granted" };
    const devNone = { role: "developer", ssh_access: "none" };
    const viewerPending = { role: "viewer", ssh_access: "pending" };
    expect(matchesMemberFilters(owner, { role: "all", ssh: "all" })).toBe(true);
    expect(matchesMemberFilters(devNone, { role: "developer", ssh: "all" })).toBe(true);
    expect(matchesMemberFilters(owner, { role: "developer", ssh: "all" })).toBe(false);
    expect(matchesMemberFilters(devNone, { role: "all", ssh: "granted" })).toBe(false);
    expect(matchesMemberFilters(devNone, { role: "all", ssh: "none" })).toBe(true);
    expect(matchesMemberFilters(viewerPending, { role: "viewer", ssh: "pending" })).toBe(true);
    expect(memberSshBucket(undefined)).toBe("none");
    expect(memberSshFilterLabel("granted")).toBe("已授权");
  });
});
