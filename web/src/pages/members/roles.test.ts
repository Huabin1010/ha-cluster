import { describe, expect, it } from "vitest";
import { ASSIGNABLE_ROLES, ROLE_HELP, roleChipLabel, roleLabel } from "./roles";

describe("member roles", () => {
  it("does not allow assigning owner via form roles", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
    expect([...ASSIGNABLE_ROLES]).toEqual(["viewer", "developer", "admin"]);
  });

  it("documents all four roles in Chinese help", () => {
    expect(ROLE_HELP.viewer).toMatch(/只读/);
    expect(ROLE_HELP.developer).toMatch(/SSH|Workspace/);
    expect(ROLE_HELP.admin).toMatch(/成员/);
    expect(ROLE_HELP.owner).toMatch(/预算/);
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
});
