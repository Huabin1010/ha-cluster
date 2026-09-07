import { expect, type Page } from "@playwright/test";

export async function openCreateDialog(page: Page, triggerTestId: string) {
  await page.getByTestId(triggerTestId).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

export async function chooseSelect(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).click();
  await page.locator(`[role="option"][data-value="${value}"]`).click();
}

export async function confirmAlert(page: Page, accept = true) {
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toBeVisible();
  await dlg.getByTestId(accept ? "confirm-ok" : "confirm-cancel").click();
}
