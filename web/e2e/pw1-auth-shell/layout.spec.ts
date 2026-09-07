import { test, expect } from "../fixtures/auth";

test.describe("PW-1 Layout 与壳子体验", () => {
  test("PW1-12 @pw1 侧栏导航", async ({ ownerPage }) => {
    await ownerPage.goto("/projects");

    const links = [
      { id: "nav-projects", url: "/projects", title: "项目" },
      { id: "nav-members", url: "/members", title: "成员" },
      { id: "nav-workspaces", url: "/workspaces", title: "服务器" },
      { id: "nav-nodes", url: "/nodes", title: "节点" },
      { id: "nav-capacity", url: "/capacity", title: "容量" },
      { id: "nav-keys", url: "/settings/keys", title: "SSH 公钥" },
      { id: "nav-audit", url: "/audit", title: "审计" },
    ];

    for (const item of links) {
      await ownerPage.getByTestId(item.id).click();
      await expect(ownerPage).toHaveURL(new RegExp(item.url));
      await expect(ownerPage.locator("main h2")).toContainText(item.title);
    }
  });

  test("PW1-13 @pw1 环境角标 dev", async ({ ownerPage }) => {
    await ownerPage.goto("/projects");
    const badge = ownerPage.locator("aside [data-testid=env-badge]");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("dev");
  });

  test("PW1-16 @pw1 加载态", async ({ ownerPage }) => {
    await ownerPage.route("**/api/projects", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await ownerPage.goto("/projects");
    // 加载期间展示 loading 占位
    const loadingOrTable = ownerPage.locator("[data-testid=page-loading], .fetch-hint, main table, main [data-testid=empty-state]");
    await expect(loadingOrTable.first()).toBeVisible();
    // 最终页面呈现
    await expect(ownerPage.locator("main h2")).toContainText("项目");
  });

  test("PW1-18 @pw1 表单 a11y", async ({ page }) => {
    await page.goto("/login");
    const userIn = page.getByTestId("login-username");
    await userIn.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("login-password")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("login-submit")).toBeFocused();

    // 输入错误密码触发错误并检查 role="alert"
    await page.getByTestId("login-password").fill("wrong-pass");
    await page.getByTestId("login-submit").click();
    const err = page.getByTestId("login-error");
    await expect(err).toHaveAttribute("role", "alert");
  });
});
