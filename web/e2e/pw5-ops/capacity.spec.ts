import { test, expect } from "../fixtures/auth";

test.describe("PW-5 容量池展示", () => {
  test("PW5-05 @pw5 @smoke 容量页", async ({ pageAs }) => {
    const { page } = await pageAs("owner");
    await page.goto("/capacity");

    const rows = page.getByTestId("capacity-row");
    await expect(rows.first()).toBeVisible();

    await expect(page.locator('[data-testid="capacity-row"]', { hasText: "amd64" })).toBeVisible();
    await expect(page.locator('[data-testid="capacity-row"]', { hasText: "arm64" })).toBeVisible();
  });

  test("PW5-06 @pw5 容量与 API 一致", async ({ pageAs }) => {
    const { page } = await pageAs("owner");

    const resPromise = page.waitForResponse((r) => r.url().includes("/api/capacity") && r.status() === 200);
    await page.goto("/capacity");
    const res = await resPromise;
    const body = (await res.json()) as {
      pools: Array<{ arch: string; cpu_milli_free: number }>;
    };

    for (const pool of body.pools) {
      const row = page.locator('[data-testid="capacity-row"]', { hasText: pool.arch });
      await expect(row).toBeVisible();
      await expect(row).toContainText(`(${pool.cpu_milli_free} milli)`);
    }
  });
});
