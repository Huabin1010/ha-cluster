import { describe, expect, it } from "vitest";
import { ASSIGNABLE_PLATFORM_ROLES, matchesUserQuery, platformRoleLabel, userStatusLabel } from "./format";

describe("user list labels", () => {
  it("maps platform roles to Chinese", () => {
    expect(platformRoleLabel("platform_admin")).toBe("平台管理员");
    expect(platformRoleLabel("platform_ops")).toBe("平台运维");
    expect(platformRoleLabel("platform_user")).toBe("普通用户");
    expect(platformRoleLabel("mystery")).toBe("mystery");
    expect(ASSIGNABLE_PLATFORM_ROLES).toContain("platform_admin");
  });

  it("maps account status to Chinese", () => {
    expect(userStatusLabel("active")).toBe("正常");
    expect(userStatusLabel("suspended")).toBe("已停用");
    expect(userStatusLabel("deleted")).toBe("已删除");
  });

  it("filters by username, email or id", () => {
    const u = { id: "abc-123", username: "chenweipeng", email: "cwp@ha-lab.test" };
    expect(matchesUserQuery(u, "")).toBe(true);
    expect(matchesUserQuery(u, "Chen")).toBe(true);
    expect(matchesUserQuery(u, "ha-lab")).toBe(true);
    expect(matchesUserQuery(u, "abc-123")).toBe(true);
    expect(matchesUserQuery(u, "nobody")).toBe(false);
  });
});
