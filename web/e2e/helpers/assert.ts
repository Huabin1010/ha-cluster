import { expect, type Page } from "@playwright/test";

export async function expectToast(page: Page, pattern?: string | RegExp) {
  const host = page.locator("[data-testid=toast-host], .toast-host");
  const banner = host.locator("[data-testid=error-banner]");
  await expect(banner).toBeVisible({ timeout: 5000 });
  if (pattern) {
    await expect(banner).toContainText(pattern);
  }
  return banner;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const isOverflowing = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth + 2;
  });
  expect(isOverflowing).toBe(false);
}
