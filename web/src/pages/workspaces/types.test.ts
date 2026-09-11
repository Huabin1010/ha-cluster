import { describe, expect, it } from "vitest";
import {
  classifyResizePreview,
  CUSTOM_PLAN,
  defaultResizePlan,
  formatPlanSpec,
  matchCatalogPlan,
  PLAN_CATALOG,
  statusLabel,
  canApproveRole,
  workspaceStatusVariant,
  workspaceStatusDotClass,
  workspaceNeedsPoll,
  workspacePollInterval,
  workspaceListQueryPollInterval,
  workspaceDetailQueryPollInterval,
  WORKSPACE_POLL_INTERVAL_MS,
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

describe("workspace polling", () => {
  const base = { status: "running", resize_status: undefined as string | undefined };

  it("polls while provisioning / destroying / awaiting approval", () => {
    expect(workspaceNeedsPoll({ ...base, status: "provisioning" })).toBe(true);
    expect(workspaceNeedsPoll({ ...base, status: "destroying" })).toBe(true);
    expect(workspaceNeedsPoll({ ...base, status: "requested" })).toBe(true);
    expect(workspaceNeedsPoll({ ...base, status: "destroy_requested" })).toBe(true);
    expect(workspaceNeedsPoll({ ...base, status: "destroy_pending_platform" })).toBe(true);
    expect(workspaceNeedsPoll({ ...base, status: "running", resize_status: "pending" })).toBe(true);
  });

  it("stops polling on steady states", () => {
    expect(workspaceNeedsPoll({ ...base, status: "running" })).toBe(false);
    expect(workspaceNeedsPoll({ ...base, status: "stopped" })).toBe(false);
    expect(workspaceNeedsPoll({ ...base, status: "failed" })).toBe(false);
    expect(workspacePollInterval([{ ...base, status: "running" }])).toBe(false);
    expect(workspacePollInterval([{ ...base, status: "provisioning" }])).toBe(WORKSPACE_POLL_INTERVAL_MS);
    expect(workspacePollInterval({ ...base, status: "provisioning" })).toBe(WORKSPACE_POLL_INTERVAL_MS);
    expect(workspacePollInterval(undefined)).toBe(false);
  });

  it("reads Refine useList/useOne data payloads", () => {
    const provisioning = { ...base, status: "provisioning" };
    expect(workspaceListQueryPollInterval({ data: [provisioning] })).toBe(WORKSPACE_POLL_INTERVAL_MS);
    expect(workspaceListQueryPollInterval({ data: [{ ...base, status: "running" }] })).toBe(false);
    expect(workspaceListQueryPollInterval(undefined)).toBe(false);
    expect(workspaceDetailQueryPollInterval({ data: provisioning })).toBe(WORKSPACE_POLL_INTERVAL_MS);
  });

  it("reads TanStack Query v5 Query objects passed as the first argument", () => {
    const provisioning = { ...base, status: "provisioning" };
    expect(
      workspaceListQueryPollInterval({
        state: { data: { data: [provisioning] } },
      }),
    ).toBe(WORKSPACE_POLL_INTERVAL_MS);
    expect(
      workspaceDetailQueryPollInterval({
        state: { data: { data: provisioning } },
      }),
    ).toBe(WORKSPACE_POLL_INTERVAL_MS);
    expect(
      workspaceDetailQueryPollInterval({
        state: { data: { data: { ...base, status: "running" } } },
      }),
    ).toBe(false);
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

describe("resize plan matching", () => {
  const Gi = 1024 * 1024 * 1024;
  const Mi = 1024 * 1024;
  const nano = PLAN_CATALOG.find((p) => p.name === "nano")!;

  it("matches catalog plan by cpu/mem/disk", () => {
    expect(matchCatalogPlan(PLAN_CATALOG, nano)?.name).toBe("nano");
    expect(
      matchCatalogPlan(PLAN_CATALOG, { cpu_milli: 1000, mem_bytes: 512 * Mi, disk_bytes: 10 * Gi }),
    ).toBeUndefined();
  });

  it("defaults to matching catalog name when disk no longer matches", () => {
    expect(
      defaultResizePlan(PLAN_CATALOG, {
        name: "small",
        cpu_milli: 1000,
        mem_bytes: 512 * Mi,
        disk_bytes: 10 * Gi,
      }),
    ).toBe("small");
    expect(defaultResizePlan(PLAN_CATALOG, nano)).toBe("nano");
    expect(
      defaultResizePlan(PLAN_CATALOG, {
        name: "legacy",
        cpu_milli: 3000,
        mem_bytes: 3 * Gi,
        disk_bytes: 12 * Gi,
      }),
    ).toBe(CUSTOM_PLAN);
  });
});

describe("classifyResizePreview", () => {
  const Gi = 1024 * 1024 * 1024;
  const cur = { name: "nano", cpu_milli: 500, mem_bytes: 256 * 1024 * 1024, disk_bytes: 5 * Gi };

  it("classifies upgrade, downgrade, mixed, unchanged and disk shrink", () => {
    expect(
      classifyResizePreview(cur, { ...cur, cpu_milli: 1000, mem_bytes: Gi, disk_bytes: 6 * Gi }).kind,
    ).toBe("upgrade");
    expect(classifyResizePreview(cur, { ...cur, cpu_milli: 250 }).kind).toBe("downgrade");
    expect(classifyResizePreview(cur, { ...cur, cpu_milli: 1000, mem_bytes: 128 * 1024 * 1024 }).kind).toBe("mixed");
    expect(classifyResizePreview(cur, { ...cur }).kind).toBe("unchanged");
    expect(classifyResizePreview(cur, { ...cur, disk_bytes: 4 * Gi }).kind).toBe("disk_shrink");
  });
});

describe("formatUsageHint", () => {
  it("mentions stopped still counts", () => {
    const s = formatUsageHint({ workspaces: 1, cpu_milli: 1000, mem_bytes: 0, disk_bytes: 0 });
    expect(s).toContain("当前已用");
    expect(s).toContain("仍计入");
  });
});
