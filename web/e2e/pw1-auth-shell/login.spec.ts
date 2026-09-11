import { test, expect } from "../fixtures/auth";
import { uniq, uniqEmail } from "../helpers/ids";

test.describe("PW-1 登录与注册", () => {
  test("PW1-01 @pw1 @smoke 错密登录", async ({ page }) => {
    await page.goto("/login");
    const userIn = page.getByTestId("login-username");
    const passIn = page.getByTestId("login-password");
    await userIn.fill("admin");
    await passIn.fill("wrong-password");
    await page.getByTestId("login-submit").click();

    const err = page.getByTestId("login-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("用户名或密码错误");
    expect(page.url()).toContain("/login");
  });

  test("PW1-02 @pw1 @smoke 正确登录", async ({ page }) => {
    await page.goto("/login");
    const userIn = page.getByTestId("login-username");
    const passIn = page.getByTestId("login-password");
    await userIn.fill("admin");
    await passIn.fill("123456qq");
    await page.getByTestId("login-submit").click();

    await expect(page).toHaveURL(/\/projects/);
    const currentUser = page.getByTestId("current-user");
    await expect(currentUser).toBeVisible();
    await expect(currentUser).toContainText("admin");
  });

  test("PW1-03 @pw1 注册新用户", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /注册/ }).click();

    const username = uniq("reg").replace(/-/g, "_").slice(0, 20);
    const email = uniqEmail("reg");
    const password = "password1";

    await page.getByTestId("login-username").fill(username);
    await page.getByTestId("login-password").fill(password);
    await page.locator("input[type=email]").fill(email);
    await page.getByRole("button", { name: "创建账号" }).click();

    const info = page.getByTestId("login-info");
    await expect(info).toBeVisible();
    await expect(info).toContainText("注册成功");

    // 成功后使用该账号登录
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByTestId("current-user")).toContainText(username);
  });

  test("PW1-04 @pw1 注册冲突", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /注册/ }).click();

    await page.getByTestId("login-username").fill("qa_owner");
    await page.getByTestId("login-password").fill("password1");
    await page.locator("input[type=email]").fill("qa_owner_new@mnnumath.vip");
    await page.getByRole("button", { name: "创建账号" }).click();

    const err = page.getByTestId("login-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("冲突");
  });

  test("PW1-05 @pw1 密码过短", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /注册/ }).click();

    await page.getByTestId("login-username").fill(uniq("short").replace(/-/g, "_"));
    await page.getByTestId("login-password").fill("123");
    await page.locator("input[type=email]").fill(uniqEmail("short"));
    await page.getByRole("button", { name: "创建账号" }).click();

    const err = page.getByTestId("login-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("输入无效");
  });
});
