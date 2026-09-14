import { describe, expect, it } from "vitest";
import { podPhaseLabel, podPhaseVariant, quotaLine, releaseLabel, replicaText } from "./k8s-status";

describe("k8s status labels", () => {
  it("maps pod phases to Chinese and semantic colors", () => {
    expect(podPhaseLabel("Running")).toBe("运行中");
    expect(podPhaseLabel("Pending")).toBe("等待中");
    expect(podPhaseLabel("Failed")).toBe("失败");
    expect(podPhaseVariant("Running", true)).toBe("ok");
    expect(podPhaseVariant("Running", false)).toBe("warn");
    expect(podPhaseVariant("Pending")).toBe("warn");
    expect(podPhaseVariant("Failed")).toBe("danger");
    expect(podPhaseVariant("Unknown")).toBe("danger");
  });

  it("formats replica fractions, release labels and quota", () => {
    expect(replicaText(0, 1)).toBe("0/1");
    expect(releaseLabel({ app: "goals", release: "v2" })).toBe("v2");
    expect(quotaLine({ "requests.cpu": "500m", pods: "20" }, { "requests.cpu": "50m", pods: "1" })).toBe(
      "requests.cpu 50m/500m · pods 1/20",
    );
  });
});
