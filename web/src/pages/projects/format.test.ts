import { describe, expect, it } from "vitest";
import { formatBytes, formatBudget, formatCpuMilli } from "./format";
import {
  canManageProject,
  isValidProjectName,
  isValidPurpose,
  purposeMissing,
  isValidSlug,
  suggestSlugFromName,
} from "./types";

describe("project slug", () => {
  it("accepts lowercase alnum hyphen", () => {
    expect(isValidSlug("demo")).toBe(true);
    expect(isValidSlug("my-app")).toBe(true);
    expect(isValidSlug("a1-b2")).toBe(true);
  });

  it("rejects invalid", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("My-App")).toBe(false);
    expect(isValidSlug("-demo")).toBe(false);
    expect(isValidSlug("demo-")).toBe(false);
    expect(isValidSlug("demo--app")).toBe(false);
    expect(isValidSlug("demo app")).toBe(false);
  });

  it("suggests slug from name", () => {
    expect(suggestSlugFromName("演示项目 Demo App!")).toBe("demo-app");
    expect(suggestSlugFromName("  My App  ")).toBe("my-app");
  });

  it("requires english project names", () => {
    expect(isValidProjectName("Office Snacks")).toBe(true);
    expect(isValidProjectName("  My-App  ")).toBe(true);
    expect(isValidProjectName("Tom's Lab")).toBe(true);
    expect(isValidProjectName("办公零食")).toBe(false);
    expect(isValidProjectName("Office零食")).toBe(false);
    expect(isValidProjectName("123")).toBe(false);
    expect(isValidProjectName("")).toBe(false);
  });

  it("owner can manage project", () => {
    expect(canManageProject("owner")).toBe(true);
    expect(canManageProject("admin")).toBe(false);
    expect(canManageProject("developer")).toBe(false);
    expect(canManageProject()).toBe(false);
  });

  it("requires a short purpose", () => {
    expect(isValidPurpose("办公零食柜")).toBe(true);
    expect(isValidPurpose("  内部协作控制台  ")).toBe(true);
    expect(isValidPurpose("")).toBe(false);
    expect(isValidPurpose("x")).toBe(false);
    expect(isValidPurpose("办公零食柜", "办公零食柜")).toBe(false);
    expect(isValidPurpose("demo-app", "Demo", "demo-app")).toBe(false);
  });

  it("treats empty purpose as blocking", () => {
    expect(purposeMissing("")).toBe(true);
    expect(purposeMissing(undefined)).toBe(true);
    expect(purposeMissing("办公零食柜")).toBe(false);
  });
});

describe("format helpers", () => {
  it("formats bytes and cpu", () => {
    expect(formatBytes(0)).toBe("0");
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatCpuMilli(1000)).toBe("1 核");
    expect(formatBudget(0, "bytes")).toBe("不限制");
    expect(formatBudget(2048, "bytes")).toBe("2 KiB");
  });
});
