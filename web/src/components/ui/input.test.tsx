import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./input";
import { SizeProvider } from "@/lib/size-context";
import { ShapeProvider } from "@/lib/shape-context";

describe("Input component", () => {
  it("renders with default shape, size, and focus ring classes", () => {
    render(<Input placeholder="输入名称…" data-testid="test-input" />);
    const input = screen.getByTestId("test-input");

    expect(input).toBeDefined();
    // Default shape is rounded -> rounded-lg
    expect(input.className).toContain("rounded-lg");
    // Default control height is h-9
    expect(input.className).toContain("h-9");
    expect(input.className).toContain("px-3");
    expect(input.className).toContain("text-[13px]");
    // Focus ring hygiene: harmonious border + single-layer focus-ring
    expect(input.className).toContain("focus-visible:border-[color:var(--focus-ring,#6B97FF)]");
    expect(input.className).toContain("focus-visible:ring-1");
    expect(input.className).toContain("focus-visible:ring-[color:var(--focus-ring,#6B97FF)]");
    // Should NOT have legacy double-border / harsh ring classes
    expect(input.className).not.toContain("border-input");
    expect(input.className).not.toContain("focus-visible:ring-2 focus-visible:ring-ring");
  });

  it("adapts to compact size when passed prop or inside SizeProvider", () => {
    render(
      <SizeProvider size="compact">
        <Input placeholder="紧凑输入" data-testid="compact-input" />
      </SizeProvider>,
    );
    const compactInput = screen.getByTestId("compact-input");
    expect(compactInput.className).toContain("h-7");
    expect(compactInput.className).toContain("px-2");
    expect(compactInput.className).toContain("text-[12px]");
  });

  it("applies error styling when error prop is provided", () => {
    render(<Input error="名称已存在" data-testid="error-input" />);
    const errorInput = screen.getByTestId("error-input");
    expect(errorInput.getAttribute("aria-invalid")).toBe("true");
    expect(errorInput.className).toContain("border-destructive/50");
    expect(errorInput.className).toContain("focus-visible:border-destructive");
  });

  it("adapts to pill shape when inside ShapeProvider defaultShape='pill'", () => {
    render(
      <ShapeProvider defaultShape="pill">
        <Input placeholder="Pill 输入" data-testid="pill-input" />
      </ShapeProvider>,
    );
    const pillInput = screen.getByTestId("pill-input");
    expect(pillInput.className).toContain("rounded-[20px]");
  });
});
