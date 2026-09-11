import { describe, expect, it, vi, afterEach } from "vitest";
import { copyText } from "./format";

describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses execCommand when clipboard is unavailable (HTTP / insecure)", async () => {
    vi.stubGlobal("isSecureContext", false);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });

    await expect(copyText("ssh lab-ws1")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("returns false when both clipboard and execCommand fail", async () => {
    vi.stubGlobal("isSecureContext", false);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });

    await expect(copyText("nope")).resolves.toBe(false);
  });
});
