import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HaBrand, HaLogo } from "./HaLogo";

describe("HaLogo", () => {
  it("renders an accessible svg mark", () => {
    const { container } = render(<HaLogo />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("ha-cluster");
    expect(svg?.querySelectorAll("circle").length).toBe(4);
  });

  it("shows wordmark unless compact", () => {
    const full = render(<HaBrand />);
    expect(full.getByTestId("brand-logo").textContent).toContain("ha-cluster");
    full.unmount();
    const compact = render(<HaBrand compact />);
    expect(compact.getByTestId("brand-logo").querySelector("svg")).toBeTruthy();
  });
});
