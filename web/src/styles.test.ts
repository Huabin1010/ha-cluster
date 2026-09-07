// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Frontend theme stylesheet verification", () => {
  const cssPath = resolve(process.cwd(), "src/styles.css");
  const css = readFileSync(cssPath, "utf-8");

  it("declares light and dark color-scheme", () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/s);
    expect(css).toMatch(/\.dark\s*\{[^}]*color-scheme:\s*dark/s);
  });

  it("contains all required semantic CSS variables in :root and .dark", () => {
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

    const root = css.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const dark = css.match(/\.dark\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    requiredVariables.forEach((varName) => {
      expect(root).toContain(`${varName}:`);
      expect(dark).toContain(`${varName}:`);
    });
  });

  it("provides WebKit autofill override for theme tokens", () => {
    expect(css).toMatch(/input:-webkit-autofill/);
    expect(css).toMatch(/-webkit-box-shadow:\s*0 0 0 1000px var\(--input-bg\) inset/);
  });

  it("configures standard and WebKit scrollbars", () => {
    expect(css).toMatch(/scrollbar-color:\s*var\(--line\) transparent/);
    expect(css).toMatch(/::-webkit-scrollbar/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb/);
  });

  it("locks option background to match theme tokens", () => {
    expect(css).toMatch(/option\s*\{[^}]*background-color:\s*var\(--panel\)/);
  });

  it("has zero hardcoded hex colors outside :root and .dark declaration blocks", () => {
    const lines = css.split("\n");
    let inTokenBlock = false;
    const leakedHexColors: { line: number; text: string }[] = [];

    lines.forEach((line: string, idx: number) => {
      if (line.includes(":root {") || line.includes(".dark {")) inTokenBlock = true;
      if (inTokenBlock && line.includes("}")) {
        inTokenBlock = false;
        return;
      }
      if (inTokenBlock) return;

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
