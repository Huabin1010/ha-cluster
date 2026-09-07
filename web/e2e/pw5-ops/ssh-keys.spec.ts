import { test, expect } from "../fixtures/auth";
import { expectToast } from "../helpers/assert";
import { openCreateDialog, confirmAlert } from "../helpers/dialog";

const SAMPLE_PUBKEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGt7Xq92h5d94mQ6JgQ7L3+vY6X9m0O9a7N1b5c8e2f3 test-user-key";

test.describe("PW-5 SSH 公钥管理", () => {
  test("PW5-07 @pw5 @smoke 添加公钥", async ({ pageAs }) => {
    const { page } = await pageAs("owner");
    await page.goto("/settings/keys");

    const keyName = `key-${Date.now()}`;
    await openCreateDialog(page, "keys-add-open");
    await page.getByTestId("keys-name").fill(keyName);
    await page.getByTestId("keys-pubkey").fill(SAMPLE_PUBKEY);
    await page.getByTestId("keys-add").click();

    await expectToast(page, "公钥已添加");

    const row = page.locator('[data-testid="keys-row"]', { hasText: keyName });
    await expect(row).toBeVisible();

    const fpText = await row.locator("td.mono").textContent();
    expect(fpText?.trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("PW5-08 @pw5 删除公钥", async ({ pageAs }) => {
    const { page } = await pageAs("owner");
    await page.goto("/settings/keys");

    const keyName = `del-key-${Date.now()}`;
    await openCreateDialog(page, "keys-add-open");
    await page.getByTestId("keys-name").fill(keyName);
    await page.getByTestId("keys-pubkey").fill(SAMPLE_PUBKEY + "-del");
    await page.getByTestId("keys-add").click();
    await expectToast(page, "公钥已添加");

    const row = page.locator('[data-testid="keys-row"]', { hasText: keyName });
    await expect(row).toBeVisible();

    await row.getByTestId("keys-remove").click();
    await confirmAlert(page, true);

    await expect(row).not.toBeVisible();
  });

  test("PW5-09 @pw5 空公钥不可提交", async ({ pageAs }) => {
    const { page } = await pageAs("owner");
    await page.goto("/settings/keys");

    await openCreateDialog(page, "keys-add-open");
    await page.getByTestId("keys-name").fill("empty-key-test");
    await page.getByTestId("keys-pubkey").fill("");

    const addBtn = page.getByTestId("keys-add");
    await expect(addBtn).toBeDisabled();
  });

  test("PW5-15 @pw5 公钥空态", async ({ freshUser }) => {
    const { page } = await freshUser("empty-keys");
    await page.goto("/settings/keys");

    const empty = page.getByTestId("empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("还没有公钥");
  });
});
