import { describe, expect, it } from "vitest";
import { podPhaseLabel, podPhaseVariant, quotaLine, releaseLabel, replicaText, eventIsStale } from "./k8s-status";

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
    expect(releaseLabel({ app: "goals" })).toBe("");
    expect(quotaLine({ "requests.cpu": "500m", pods: "20" }, { "requests.cpu": "50m", pods: "1" })).toBe(
      "CPU 50m / 500m · Pod 1 / 20",
    );
    expect(quotaLine({ "requests.memory": "2147483648" }, { "requests.memory": "128Mi" })).toBe("内存 128Mi / 2Gi");
  });

  it("treats scaled-to-zero ReplicaSet warnings as history", () => {
    expect(
      eventIsStale(
        { type: "Warning", reason: "FailedCreate", message: "quota", object_kind: "ReplicaSet", object_name: "old" },
        [{ name: "old", namespace: "ns", desired: 0, current: 0, ready: 0, active: false }],
      ),
    ).toBe(true);
    expect(
      eventIsStale(
        { type: "Warning", reason: "FailedCreate", message: "quota", object_kind: "ReplicaSet", object_name: "cur" },
        [{ name: "cur", namespace: "ns", desired: 2, current: 2, ready: 2, active: true }],
      ),
    ).toBe(false);
  });
});
