import { test, expect } from "../fixtures/auth";

test.describe("PW-5 审计日志", () => {
  test("PW5-10 @pw5 @smoke admin 审计", async ({ adminPage }) => {
    await adminPage.goto("/audit");

    const table = adminPage.getByTestId("audit-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText("user.login");
  });

  test("PW5-11 @pw5 @smoke 非 admin 审计", async ({ ownerPage }) => {
    await ownerPage.goto("/audit");

    const forbidden = ownerPage.getByTestId("audit-forbidden");
    await expect(forbidden).toBeVisible();
    await expect(forbidden).toContainText("没有权限查看审计日志");
  });

  test("PW5-14 @pw5 审计加载", async ({ adminPage }) => {
    await adminPage.route("**/api/audit-logs*", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    await adminPage.goto("/audit");
    const skeleton = adminPage.getByTestId("page-skeleton");
    await expect(skeleton).toBeVisible();

    const table = adminPage.getByTestId("audit-table");
    await expect(table).toBeVisible({ timeout: 5000 });
  });
});
