import { expect } from "@playwright/test";
import { test } from "../e2e/fixtures/auth";

test.describe("Real Machine: 04 真实动作审计与容量变动对账", () => {
  test("REAL-AUDIT-01 验证审计日志记录真实工作区生命周期动作", async ({ adminPage }) => {
    await adminPage.goto("/audit");
    await expect(adminPage.locator("[data-testid=audit-table]")).toBeVisible({ timeout: 15_000 });

    // 检查存在操作记录
    const rows = adminPage.locator("[data-testid=audit-table] tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });

    // 检查存在「创建 Workspace」或「销毁 Workspace」等真实记录
    const createLogs = rows.filter({ hasText: /开通服务器|创建 Workspace|申请服务器/ });
    await expect(createLogs.first()).toBeVisible();
  });
});
