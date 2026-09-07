import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";

test.describe("PW-1 会话与凭证流转", () => {
  test("PW1-06 @pw1 @smoke 未登录访问受保护页", async ({ page }) => {
    await page.goto("/workspaces");
    await expect(page).toHaveURL(/\/login/);
    expect(page.url()).not.toContain("reason=");
  });

  test("PW1-07 @pw1 已登录访问 /login", async ({ ownerPage }) => {
    await ownerPage.goto("/login");
    await expect(ownerPage).toHaveURL(/\/projects/);
  });

  test("PW1-08 @pw1 退出", async ({ ownerPage }) => {
    await ownerPage.goto("/projects");
    await ownerPage.getByTestId("logout-button").click();
    await expect(ownerPage).toHaveURL(/\/login/);

    await ownerPage.goto("/projects");
    await expect(ownerPage).toHaveURL(/\/login/);
  });

  test("PW1-09 @pw1 清 token 强刷", async ({ ownerPage }) => {
    await ownerPage.goto("/projects");
    await ownerPage.evaluate(() => {
      localStorage.removeItem("ha_token");
      localStorage.removeItem("ha_refresh");
    });
    await ownerPage.reload();
    await expect(ownerPage).toHaveURL(/\/login/);
  });

  test("PW1-10 @pw1 过期提示", async ({ page }) => {
    await page.goto("/login?reason=expired");
    const info = page.getByTestId("login-info");
    await expect(info).toBeVisible();
    await expect(info).toContainText("过期");
  });

  test("PW1-11 @pw1 @slow refresh 轮换 UI", async ({ browser, baseURL }) => {
    // a) 伪造 ha_token + 有效 ha_refresh -> 触发刷新后正常停留在 /projects
    const tokens = await api.login("qa_dev", "password1");
    const ctx = await browser.newContext({
      baseURL,
      storageState: {
        cookies: [],
        origins: [
          {
            origin: baseURL ?? "http://127.0.0.1:5173",
            localStorage: [
              { name: "ha_token", value: "fake-expired-jwt-token" },
              { name: "ha_refresh", value: tokens.refresh_token },
              { name: "ha_user", value: JSON.stringify(tokens.user) },
            ],
          },
        ],
      },
    });
    const pageA = await ctx.newPage();
    await pageA.goto("/projects");
    await expect(pageA).toHaveURL(/\/projects/);
    await expect(pageA.getByTestId("current-user")).toContainText("qa_dev");
    await ctx.close();

    // b) 伪造 token + 已登出的 refresh_token -> 刷新失败跳 /login?reason=expired
    const tokensB = await api.login("qa_viewer", "password1");
    await api.logout(tokensB.refresh_token);

    const ctxB = await browser.newContext({
      baseURL,
      storageState: {
        cookies: [],
        origins: [
          {
            origin: baseURL ?? "http://127.0.0.1:5173",
            localStorage: [
              { name: "ha_token", value: "fake-expired-jwt-token" },
              { name: "ha_refresh", value: tokensB.refresh_token },
              { name: "ha_user", value: JSON.stringify(tokensB.user) },
            ],
          },
        ],
      },
    });
    const pageB = await ctxB.newPage();
    await pageB.goto("/projects");
    await expect(pageB).toHaveURL(/login\?reason=expired/);
    await ctxB.close();
  });

  test("PW1-17 @pw1 网络错误保壳", async ({ ownerPage }) => {
    await ownerPage.goto("/projects");
    await ownerPage.route("**/api/me", (route) => {
      route.fulfill({ status: 503, body: "service unavailable" });
    });
    await ownerPage.reload();
    // 应当留在壳子内部，token 没有被清空
    await expect(ownerPage).toHaveURL(/\/projects/);
    const token = await ownerPage.evaluate(() => localStorage.getItem("ha_token"));
    expect(token).toBeTruthy();
  });
});
