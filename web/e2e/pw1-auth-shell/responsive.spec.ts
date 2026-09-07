import { test, expect } from "../fixtures/auth";
import { expectNoHorizontalOverflow } from "../helpers/assert";

test.describe("PW-1 窄屏与响应式", () => {
  test("PW1-14 @pw1 @responsive 窄屏菜单", async ({ ownerPage }) => {
    await ownerPage.goto("/projects");
    const toggle = ownerPage.getByTestId("nav-toggle");
    await expect(toggle).toBeVisible();

    await toggle.click();
    const shell = ownerPage.locator(".shell");
    await expect(shell).toHaveClass(/nav-open/);

    const backdrop = ownerPage.locator(".nav-backdrop");
    await expect(backdrop).toBeVisible();
    await backdrop.click();
    await expect(shell).not.toHaveClass(/nav-open/);
  });

  test("PW1-15 @pw1 @responsive 窄屏不横向溢出", async ({ ownerPage }) => {
    const routes = ["/projects", "/workspaces", "/nodes", "/capacity", "/settings/keys", "/audit"];
    for (const r of routes) {
      await ownerPage.goto(r);
      await ownerPage.locator("main h2").waitFor();
      await expectNoHorizontalOverflow(ownerPage);
    }
  });
});
