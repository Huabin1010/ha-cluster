import { expect, type Page } from "@playwright/test";

export async function expectToast(page: Page, pattern?: string | RegExp) {
  const toast = page.locator("[data-sonner-toast], [data-testid=toast-host], .toast-host").first();
  await expect(toast).toBeVisible({ timeout: 5000 });
  if (pattern) {
    await expect(toast).toContainText(pattern);
  }
  return toast;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const isOverflowing = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth + 2;
  });
  expect(isOverflowing).toBe(false);
}
