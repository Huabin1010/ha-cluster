import { test, expect } from "../fixtures/auth";
import { openCreateDialog, chooseSelect, confirmAlert } from "../helpers/dialog";
import { seedProject } from "../fixtures/seed";

test.describe("PW-5 用户与团队", () => {
  test("PW5-20 @pw5 @smoke admin 用户列表", async ({ adminPage }) => {
    await adminPage.goto("/users");

    await expect(adminPage.getByTestId("nav-users")).toBeVisible();
    const table = adminPage.getByTestId("users-table");
    await expect(table).toBeVisible();
    await expect(adminPage.getByTestId("users-row").filter({ hasText: "admin" }).first()).toBeVisible();
  });

  test("PW5-21 @pw5 @smoke 非 admin 看不到用户页", async ({ ownerPage }) => {
    await ownerPage.goto("/projects");
    await expect(ownerPage.getByTestId("nav-users")).toHaveCount(0);

    await ownerPage.goto("/users");
    const forbidden = ownerPage.getByTestId("users-forbidden");
    await expect(forbidden).toBeVisible();
    await expect(forbidden).toContainText("无权查看用户列表");
  });

  test("PW5-22 @pw5 admin 批量创建入口", async ({ adminPage }) => {
    await adminPage.goto("/users");
    await openCreateDialog(adminPage, "users-batch-create-open");
    await expect(adminPage.getByTestId("batch-create-dialog")).toBeVisible();
    await expect(adminPage.getByTestId("batch-create-textarea")).toBeVisible();
  });

  test("PW5-23 @pw5 admin 把用户加入项目", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("admin");
    const p = await seedProject(tokens.token, "add-user");

    await page.goto("/users");
    await page.getByTestId("users-search").fill("qa_dev");
    const row = page.getByTestId("users-row").filter({ hasText: "qa_dev" }).first();
    await expect(row).toBeVisible();
    await row.getByTestId("users-configure").click();
    await expect(page.getByTestId("users-configure-dialog")).toBeVisible();
    await page.getByTestId("users-add-to-project").click();

    const dialog = page.getByTestId("users-add-dialog");
    await expect(dialog).toBeVisible();
    await chooseSelect(page, "users-add-project", p.id);
    await chooseSelect(page, "users-add-role", "developer");
    await page.getByTestId("users-add-submit").click();

    await expect(dialog).toBeHidden();
    await expect(row).toContainText(p.name);
  });

  test("PW5-24 @pw5 admin 重置密码", async ({ pageAs, freshUser }) => {
    const created = await freshUser("rstpw");
    const { page } = await pageAs("admin");

    await page.goto("/users");
    await page.getByTestId("users-search").fill(created.username);
    const row = page.getByTestId("users-row").filter({ hasText: created.username }).first();
    await expect(row).toBeVisible();
    await row.getByTestId("users-reset-password").click();

    const dialog = page.getByTestId("users-reset-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("users-reset-submit").click();
    await expect(page.getByTestId("users-reset-copy")).toBeVisible();
  });

  test("PW5-25 @pw5 admin 删除用户", async ({ pageAs, freshUser }) => {
    const created = await freshUser("delusr");
    const { page } = await pageAs("admin");

    await page.goto("/users");
    await page.getByTestId("users-search").fill(created.username);
    const row = page.getByTestId("users-row").filter({ hasText: created.username }).first();
    await expect(row).toBeVisible();
    await row.getByTestId("users-delete").click();
    await confirmAlert(page);

    await expect(page.getByTestId("users-row").filter({ hasText: created.username })).toHaveCount(0);
  });
});
