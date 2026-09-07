import { describe, expect, it } from "vitest";
import { fmtBytes, fmtCPU, fmtTime } from "./format";

describe("ops/format", () => {
  it("fmtBytes scales Mi/Gi", () => {
    expect(fmtBytes(0)).toBe("0");
    expect(fmtBytes(1024 * 1024)).toBe("1 Mi");
    expect(fmtBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 Gi");
  });

  it("fmtCPU shows cores", () => {
    expect(fmtCPU(0)).toBe("0");
    expect(fmtCPU(1000)).toBe("1 核");
    expect(fmtCPU(1500)).toBe("1.5 核");
  });

  it("fmtTime handles empty", () => {
    expect(fmtTime("")).toBe("—");
  });
});
