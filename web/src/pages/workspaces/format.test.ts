import { describe, expect, it } from "vitest";
import { formatCapacityAvailable, formatCapacityUnavailable, type CapacityPreview } from "./format";

function preview(partial: Partial<CapacityPreview>): CapacityPreview {
  return {
    available: false,
    cluster_ok: true,
    budget_ok: true,
    fits: 0,
    nodes: 0,
    plan: "nano",
    arch: "amd64",
    runtime: "container",
    ...partial,
  };
}

describe("formatCapacity", () => {
  it("shows how many machines still fit", () => {
    expect(formatCapacityAvailable(preview({ available: true, fits: 3 }))).toBe(
      "amd64 · nano 当前还可分配 3 台",
    );
  });

  it("prefers cluster reason then budget", () => {
    expect(
      formatCapacityUnavailable(
        preview({
          cluster_ok: false,
          budget_ok: false,
          reason: "该架构节点空闲容量不够放下此套餐",
          budget_reason: "超出项目 CPU 预算",
        }),
      ),
    ).toBe("该架构节点空闲容量不够放下此套餐。超出项目 CPU 预算");
  });
});
