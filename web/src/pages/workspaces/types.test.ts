import { describe, expect, it } from "vitest";
import { statusLabel } from "./types";
import { formatUsageHint } from "./format";

describe("workspace statusLabel", () => {
  it("maps required statuses to Chinese", () => {
    expect(statusLabel("running")).toBe("运行中");
    expect(statusLabel("stopped")).toBe("已停止（仍占配额）");
    expect(statusLabel("fabric_degraded")).toBe("网络降级");
    expect(statusLabel("failed")).toBe("失败");
  });

  it("falls back to raw status", () => {
    expect(statusLabel("custom")).toBe("custom");
  });
});

describe("formatUsageHint", () => {
  it("mentions stopped still counts", () => {
    const s = formatUsageHint({ workspaces: 1, cpu_milli: 1000, mem_bytes: 0, disk_bytes: 0 });
    expect(s).toContain("当前已用");
    expect(s).toContain("仍计入");
  });
});
