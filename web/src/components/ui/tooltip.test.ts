import { describe, expect, it } from "vitest";
import { tooltipPanelClass } from "./tooltip";

describe("tooltipPanelClass", () => {
  it("surface tone never uses inverted chip or text-box trim", () => {
    const cls = tooltipPanelClass("surface", "rounded-lg", "max-w-[300px]");
    expect(cls).toContain("bg-surface-2");
    expect(cls).toContain("text-foreground");
    expect(cls).toContain("max-w-[300px]");
    expect(cls.split(/\s+/)).not.toContain("bg-foreground");
    expect(cls.split(/\s+/)).not.toContain("text-background");
    expect(cls).not.toContain("text-box:trim-both");
  });

  it("default Hint/Tooltip tone matches the current theme", () => {
    const cls = tooltipPanelClass("surface", "rounded-lg");
    expect(cls).toContain("bg-surface-2");
    expect(cls).toContain("text-foreground");
  });

  it("invert tone keeps the short-label chip", () => {
    const cls = tooltipPanelClass("invert", "rounded-lg");
    expect(cls.split(/\s+/)).toContain("bg-foreground");
    expect(cls.split(/\s+/)).toContain("text-background");
    expect(cls).toContain("text-box:trim-both");
  });
});
