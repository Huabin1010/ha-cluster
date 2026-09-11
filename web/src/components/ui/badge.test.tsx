import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";
import { Shield } from "lucide-react";

describe("Badge component", () => {
  it("renders with single-line, non-wrapping flex layout", () => {
    render(<Badge data-testid="test-badge">标签内容</Badge>);
    const badge = screen.getByTestId("test-badge");

    expect(badge.className).toContain("inline-flex");
    expect(badge.className).toContain("items-center");
    expect(badge.className).toContain("whitespace-nowrap");
    expect(badge.className).toContain("shrink-0");
  });

  it("does NOT render status dot for outline variant by default", () => {
    const { container } = render(
      <Badge variant="outline" data-testid="outline-badge">
        <Shield data-testid="shield-icon" />
        角色: OWNER
      </Badge>,
    );
    const badge = screen.getByTestId("outline-badge");
    // Only one wrapper span for content, no dot span
    const spans = badge.querySelectorAll("span");
    expect(spans.length).toBe(1);
    expect(spans[0].className).toContain("whitespace-nowrap");
    expect(spans[0].className).toContain("inline-flex");
  });

  it("renders status dot when variant is dot or dot prop is explicitly true", () => {
    const { container } = render(
      <Badge variant="dot" data-testid="dot-badge">
        在线
      </Badge>,
    );
    const badge = screen.getByTestId("dot-badge");
    const spans = badge.querySelectorAll("span");
    // One dot span + one content span
    expect(spans.length).toBe(2);
    expect(spans[0].className).toContain("rounded-full");
  });

  it("keeps icons and text strictly in a single non-wrapping row", () => {
    render(
      <Badge variant="outline" data-testid="role-badge">
        <Shield data-testid="shield-icon" />
        角色: OWNER
      </Badge>,
    );
    const badge = screen.getByTestId("role-badge");
    const contentSpan = badge.querySelector("span");
    expect(contentSpan).not.toBeNull();
    expect(contentSpan?.className).toContain("inline-flex");
    expect(contentSpan?.className).toContain("items-center");
    expect(contentSpan?.className).toContain("gap-1");
    expect(contentSpan?.className).toContain("whitespace-nowrap");
    expect(contentSpan?.className).toContain("shrink-0");
  });
});
