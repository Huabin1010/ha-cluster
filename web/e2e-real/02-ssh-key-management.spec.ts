import { expect } from "@playwright/test";
import { test } from "../e2e/fixtures/auth";
import { generateSSHKeyPair } from "./helpers";
import { uniq } from "../e2e/helpers/ids";

test.describe("Real Machine: 02 真实 SSH 密钥管理与分发预备", () => {
  test("REAL-SSH-01 在用户控制台登记真实 ED25519 公钥", async ({ ownerPage }) => {
    const keyPair = generateSSHKeyPair("real_owner_key");
    const keyName = uniq("key-real");

    await ownerPage.goto("/settings/keys");
    await expect(ownerPage.locator("[data-testid=keys-name]")).toBeVisible({ timeout: 15_000 });

    await ownerPage.fill("[data-testid=keys-name]", keyName);
    await ownerPage.fill("[data-testid=keys-pubkey]", keyPair.publicKey);
    await ownerPage.click("[data-testid=keys-add]");

    // 验证列表中显示新添加的公钥
    const row = ownerPage.locator("table tbody tr", { hasText: keyName });
    await expect(row).toBeVisible({ timeout: 15_000 });
  });
});
