import { test, expect } from "../fixtures/auth";

test.describe("PW-5 审计日志", () => {
  test("PW5-10 @pw5 @smoke admin 审计", async ({ adminPage }) => {
    await adminPage.goto("/audit");

    const table = adminPage.getByTestId("audit-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText("用户登录");
  });

  test("PW5-11 @pw5 @smoke 非 admin 审计", async ({ ownerPage }) => {
    await ownerPage.goto("/audit");

    const forbidden = ownerPage.getByTestId("audit-forbidden");
    await expect(forbidden).toBeVisible();
    await expect(forbidden).toContainText("没有权限查看审计日志");
  });

  test("PW5-15 @pw5 动作中文与资源跳转", async ({ adminPage }) => {
    await adminPage.route("**/api/audit-logs*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: 720,
              actor_user_id: "admin",
              actor_username: "admin",
              actor_display_name: "管理员",
              action: "ssh.exec",
              resource_type: "workspace",
              resource_id: "ws-demo-id",
              resource_name: "liuhuapiaoyuan",
              created_at: "2026-09-12T23:26:05Z",
            },
            {
              id: 719,
              actor_user_id: "admin",
              actor_username: "admin",
              action: "ssh.exec.deny",
              resource_type: "workspace",
              resource_id: "ws-demo-id",
              resource_name: "liuhuapiaoyuan",
              created_at: "2026-09-12T23:25:56Z",
            },
          ],
          total: 2,
        }),
      });
    });

    await adminPage.goto("/audit");
    const table = adminPage.getByTestId("audit-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText("SSH 执行命令");
    await expect(table).toContainText("SSH 执行失败");
    await expect(table).not.toContainText("ssh.exec");

    await adminPage.getByTestId("audit-actor").first().hover();
    const actorHover = adminPage.getByTestId("audit-actor-hover");
    await expect(actorHover).toBeVisible();
    await expect(actorHover).toContainText("最近操作");

    await adminPage.getByTestId("audit-target-link").first().hover();
    const targetHover = adminPage.getByTestId("audit-target-hover");
    await expect(targetHover).toBeVisible();
    await expect(targetHover).toContainText("最近变动");

    await adminPage.getByTestId("audit-target-link").first().click();
    await expect(adminPage).toHaveURL(/\/workspaces\/ws-demo-id/);
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
