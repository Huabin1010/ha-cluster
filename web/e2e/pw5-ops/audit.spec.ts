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
              resource_name: "huanghuabin",
              meta: { username: "huanghuabin", command: "uname -a", stdout: "Linux box 6.8.0\n", exit_code: 0 },
              created_at: "2026-09-12T23:26:05Z",
            },
            {
              id: 719,
              actor_user_id: "admin",
              actor_username: "admin",
              action: "ssh.exec.deny",
              resource_type: "workspace",
              resource_id: "ws-demo-id",
              resource_name: "huanghuabin",
              meta: { username: "huanghuabin", command: "uname -a", error: "connection reset by peer" },
              created_at: "2026-09-12T23:25:56Z",
            },
          ],
          total: 2,
        }),
      });
    });
    await adminPage.route("**/api/workspaces*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "ws-demo-id",
              name: "办公零食柜",
              status: "running",
              plan: "2c2g",
              arch: "amd64",
              project_id: "p-demo",
            },
          ],
          total: 1,
        }),
      });
    });

    await adminPage.goto("/audit");
    const table = adminPage.getByTestId("audit-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText("SSH 执行命令");
    await expect(table).toContainText("SSH 执行失败");
    await expect(table).not.toContainText("ssh.exec");
    await expect(table).toContainText("办公零食柜");
    await expect(table.getByTestId("audit-target-link").first()).not.toContainText("huanghuabin");
    await expect(adminPage.getByTestId("audit-copy").first()).toBeVisible();

    await adminPage.getByTestId("audit-exec-command").first().click();
    const execDlg = adminPage.getByTestId("audit-exec-dialog");
    await expect(execDlg).toBeVisible();
    await expect(adminPage.getByTestId("audit-exec-input")).toContainText("uname -a");
    await expect(adminPage.getByTestId("audit-exec-output")).toContainText("Linux box");
    await execDlg.getByRole("button", { name: "关闭" }).click();
    await expect(execDlg).toBeHidden();

    await adminPage.getByTestId("audit-copy").first().click();
    await expect(adminPage.getByText("已复制排查信息")).toBeVisible();

    await adminPage.getByTestId("audit-actor").first().hover();
    const actorHover = adminPage.getByTestId("audit-actor-hover");
    await expect(actorHover).toBeVisible();
    await expect(actorHover).toContainText("最近操作");

    await adminPage.getByTestId("audit-target-link").first().hover();
    const targetHover = adminPage.getByTestId("audit-target-hover");
    await expect(targetHover).toBeVisible();
    await expect(targetHover).toContainText("最近变动");
    await expect(targetHover).toContainText("办公零食柜");

    await adminPage.getByTestId("audit-target-link").first().click();
    await expect(adminPage).toHaveURL(/\/workspaces\/ws-demo-id/);
  });

  test("PW5-16 @pw5 证书显示域名且已销毁资源提示", async ({ adminPage }) => {
    await adminPage.route("**/api/audit-logs*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: 801,
              actor_user_id: "admin",
              actor_username: "admin",
              actor_display_name: "管理员",
              action: "tls.issue",
              resource_type: "tls_cert",
              resource_id: "6c2a07c2-aaaa-bbbb-cccc-dddddddddddd",
              meta: { names: ["*.apps.cl.qzsyzn.com", "apps.cl.qzsyzn.com"], issuer: "Let's Encrypt" },
              created_at: "2026-09-14T05:38:02Z",
            },
            {
              id: 800,
              actor_user_id: "admin",
              actor_username: "admin",
              actor_display_name: "管理员",
              action: "workspace.destroy",
              resource_type: "workspace",
              resource_id: "ws-gone-id",
              resource_name: "snacks-1",
              meta: { workspace_name: "snacks-1" },
              created_at: "2026-09-14T05:33:40Z",
            },
          ],
          total: 2,
        }),
      });
    });
    await adminPage.route("**/api/workspaces*", async (route) => {
      const url = route.request().url();
      if (/\/workspaces\/ws-gone-id/.test(url)) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "not found" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], total: 0 }),
      });
    });
    await adminPage.route("**/api/projects*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], total: 0 }),
      });
    });
    await adminPage.route("**/api/admin/tls-certs*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], total: 0 }),
      });
    });

    await adminPage.goto("/audit");
    const table = adminPage.getByTestId("audit-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText("签发 TLS 证书");
    await expect(table).toContainText("*.apps.cl.qzsyzn.com");
    await expect(table).not.toContainText("6c2a07c2");
    await expect(table).toContainText("snacks-1");

    await table.getByTestId("audit-target-link").nth(1).click();
    await expect(adminPage.getByText("资源已被销毁")).toBeVisible();
    await expect(adminPage).toHaveURL(/\/audit/);
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
