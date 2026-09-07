// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Frontend Dark Mode Stylesheet Verification", () => {
  const cssPath = resolve(process.cwd(), "src/styles.css");
  const css = readFileSync(cssPath, "utf-8");

  it("declares color-scheme: dark in :root", () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });

  it("contains all required semantic CSS variables in :root", () => {
    const requiredVariables = [
      "--bg",
      "--panel",
      "--line",
      "--line-strong",
      "--text",
      "--muted",
      "--accent",
      "--danger",
      "--ok",
      "--focus",
      "--input-bg",
      "--text-inverse",
      "--text-bright",
      "--badge-ok-bg",
      "--badge-ok-text",
      "--badge-warn-bg",
      "--badge-warn-text",
      "--badge-danger-bg",
      "--badge-danger-text",
      "--banner-error-bg",
      "--banner-error-border",
      "--banner-info-bg",
      "--banner-info-border",
      "--banner-success-bg",
      "--banner-success-border",
      "--skeleton-shimmer",
      "--token-box-bg",
    ];

    requiredVariables.forEach((varName) => {
      expect(css).toContain(`${varName}:`);
    });
  });

  it("provides WebKit autofill override for dark theme", () => {
    expect(css).toMatch(/input:-webkit-autofill/);
    expect(css).toMatch(/-webkit-box-shadow:\s*0 0 0 1000px var\(--input-bg\) inset/);
  });

  it("configures standard and WebKit scrollbars", () => {
    expect(css).toMatch(/scrollbar-color:\s*var\(--line\) transparent/);
    expect(css).toMatch(/::-webkit-scrollbar/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb/);
  });

  it("locks option background to match dark theme", () => {
    expect(css).toMatch(/option\s*\{[^}]*background-color:\s*var\(--panel\)/);
  });

  it("has zero hardcoded hex colors outside :root declaration block", () => {
    const lines = css.split("\n");
    let inRoot = false;
    const leakedHexColors: { line: number; text: string }[] = [];

    lines.forEach((line: string, idx: number) => {
      if (line.includes(":root {")) inRoot = true;
      if (inRoot && line.includes("}")) {
        inRoot = false;
        return;
      }
      if (inRoot) return;

      const hexMatches = line.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hexMatches) {
        leakedHexColors.push({ line: idx + 1, text: line.trim() });
      }
    });

    expect(leakedHexColors).toEqual([]);
  });

  it("has no conflicting duplicate definitions for .ok", () => {
    const okMatches = css.match(/^\.ok\s*\{/gm) || [];
    expect(okMatches.length).toBe(1);
  });
});
