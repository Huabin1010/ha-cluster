import { describe, expect, it } from "vitest";
import { formatBytes, formatBudget, formatCpuMilli } from "./format";
import { isValidSlug } from "./types";

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
