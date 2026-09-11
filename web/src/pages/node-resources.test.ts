import { describe, expect, it } from "vitest";
import { hostDiskMeter, hostMemMeter, isHostPressure } from "./node-resources";

const Gi = 1024 * 1024 * 1024;

describe("host resource meters", () => {
  it("uses host used = total - available when totals are present", () => {
    const mem = hostMemMeter({
      mem_total_bytes: 4 * Gi,
      mem_available_bytes: 3 * Gi,
      used_mem_bytes: 0,
      allocatable_mem_bytes: 4 * Gi,
    });
    expect(mem.source).toBe("host");
    expect(mem.used).toBe(Gi);
    expect(mem.total).toBe(4 * Gi);
    expect(mem.ledgerUsed).toBe(0);

    const disk = hostDiskMeter({
      disk_total_bytes: 40 * Gi,
      disk_free_bytes: 30 * Gi,
      used_disk_bytes: 10 * Gi,
      allocatable_disk_bytes: 32 * Gi,
    });
    expect(disk.source).toBe("host");
    expect(disk.used).toBe(10 * Gi);
    expect(disk.total).toBe(40 * Gi);
    expect(disk.ledgerUsed).toBe(10 * Gi);
  });

  it("falls back to ledger when the agent has not reported host totals", () => {
    const mem = hostMemMeter({
      mem_available_bytes: 3 * Gi,
      used_mem_bytes: 0,
      allocatable_mem_bytes: 4 * Gi,
    });
    expect(mem.source).toBe("ledger");
    expect(mem.used).toBe(0);
    expect(mem.total).toBe(4 * Gi);
  });

  it("flags host pressure from remaining ratio", () => {
    const ok = hostMemMeter({
      mem_total_bytes: 4 * Gi,
      mem_available_bytes: 2 * Gi,
    });
    expect(isHostPressure(ok)).toBe(false);
    const low = hostMemMeter({
      mem_total_bytes: 4 * Gi,
      mem_available_bytes: 0.2 * Gi,
    });
    expect(isHostPressure(low)).toBe(true);
  });
});
