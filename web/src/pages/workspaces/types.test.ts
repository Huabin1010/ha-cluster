import { describe, expect, it } from "vitest";
import {
  formatPlanSpec,
  statusLabel,
  canApproveRole,
  workspaceStatusVariant,
  workspaceStatusDotClass,
} from "./types";
import { formatUsageHint } from "./format";

describe("formatPlanSpec", () => {
  it("formats plan specs correctly", () => {
    const Mi = 1024 * 1024;
    const Gi = 1024 * Mi;
    expect(
      formatPlanSpec({ name: "nano", cpu_milli: 500, mem_bytes: 256 * Mi, disk_bytes: 5 * Gi }),
    ).toBe("0.5核 / 256MiB / 5GiB");
    expect(
      formatPlanSpec({ name: "2c2g", cpu_milli: 2000, mem_bytes: 2 * Gi, disk_bytes: 5 * Gi }),
    ).toBe("2核 / 2GiB / 5GiB");
    expect(
      formatPlanSpec({ name: "custom", cpu_milli: 8000, mem_bytes: 16 * Gi, disk_bytes: 1024 * Gi }),
    ).toBe("8核 / 16GiB / 1TiB");
  });
});

describe("workspace statusLabel", () => {
  it("maps required statuses to Chinese", () => {
    expect(statusLabel("running")).toBe("运行中");
    expect(statusLabel("requested")).toBe("待审批");
    expect(statusLabel("rejected")).toBe("已拒绝");
    expect(statusLabel("stopped")).toBe("已停止（仍占配额）");
    expect(statusLabel("fabric_degraded")).toBe("网络降级");
    expect(statusLabel("destroy_requested")).toBe("待销毁审批");
    expect(statusLabel("destroy_pending_platform")).toBe("待平台终审");
    expect(statusLabel("failed")).toBe("失败");
  });

  it("falls back to raw status", () => {
    expect(statusLabel("custom")).toBe("custom");
  });

  it("maps status to semantic badge variant correctly", () => {
    expect(workspaceStatusVariant("running")).toBe("ok");
    expect(workspaceStatusVariant("requested")).toBe("warn");
    expect(workspaceStatusVariant("fabric_degraded")).toBe("warn");
    expect(workspaceStatusVariant("failed")).toBe("danger");
    expect(workspaceStatusVariant("rejected")).toBe("danger");
    expect(workspaceStatusVariant("stopped")).toBe("outline");
  });

  it("maps status to status dot class correctly and prevents green on failure", () => {
    expect(workspaceStatusDotClass("running")).toContain("bg-emerald-500");
    expect(workspaceStatusDotClass("failed")).toContain("bg-rose-500");
    expect(workspaceStatusDotClass("failed")).not.toContain("bg-emerald-500");
    expect(workspaceStatusDotClass("requested")).toContain("bg-amber-500");
    expect(workspaceStatusDotClass("stopped")).toContain("bg-muted-foreground");
  });
});

describe("canApproveRole", () => {
  it("allows owner/admin/platform_admin", () => {
    expect(canApproveRole("owner")).toBe(true);
    expect(canApproveRole("admin")).toBe(true);
    expect(canApproveRole("developer", "platform_admin")).toBe(true);
    expect(canApproveRole("developer")).toBe(false);
    expect(canApproveRole("viewer")).toBe(false);
  });
});

describe("formatUsageHint", () => {
  it("mentions stopped still counts", () => {
    const s = formatUsageHint({ workspaces: 1, cpu_milli: 1000, mem_bytes: 0, disk_bytes: 0 });
    expect(s).toContain("当前已用");
    expect(s).toContain("仍计入");
  });
});
