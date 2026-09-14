import { describe, expect, it } from "vitest";
import { canViewGlobalMembers } from "./permissions";

describe("canViewGlobalMembers", () => {
  it("allows only platform_admin", () => {
    expect(canViewGlobalMembers("platform_admin")).toBe(true);
    expect(canViewGlobalMembers("platform_ops")).toBe(false);
    expect(canViewGlobalMembers(undefined)).toBe(false);
    expect(canViewGlobalMembers("")).toBe(false);
  });
});
