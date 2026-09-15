import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject } from "../fixtures/seed";
import { openCreateDialog, chooseSelect, chooseCombobox } from "../helpers/dialog";

test.describe("PW-3 成员管理与列表", () => {
  test("PW3-01 @pw3 @smoke 从项目进成员", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "mem");

    await page.goto(`/projects/${p.id}/members`);
    const table = page.getByTestId("member-table");
    await expect(table).toBeVisible();

    const row = page.getByTestId("member-row");
    await expect(row.first()).toBeVisible();
    await expect(row.first()).toContainText("所有者");
  });

  test("PW3-02 @pw3 @smoke query 带入项目", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("admin");
    const p = await seedProject(tokens.token, "query");

    await page.goto(`/members?project_id=${p.id}`);
    const select = page.getByTestId("member-project");
    await expect(select).toHaveAttribute("data-value", p.id);

    await expect(page.getByTestId("member-table")).toBeVisible();
  });

  test("PW3-03 @pw3 @smoke owner 加 developer", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "add-dev");

    await page.goto(`/projects/${p.id}/members`);
    await openCreateDialog(page, "member-add-open");
    await chooseCombobox(page, "member-username", "qa_dev");
    await chooseSelect(page, "member-role", "developer");
    await page.getByTestId("member-add").click();

    // 表格中出现两条成员记录，并且包含 developer
    const rows = page.getByTestId("member-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "开发" })).toBeVisible();
  });

  test("PW3-04 @pw3 角色说明", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "help");

    await page.goto(`/projects/${p.id}/members`);
    const help = page.getByTestId("role-help");
    await expect(help).toBeVisible();
    await help.click();
    const dialog = page.getByTestId("role-help-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("viewer");
    await expect(dialog).toContainText("developer");
    await expect(dialog).toContainText("admin");
    await expect(dialog).toContainText("owner");
    await expect(dialog).toContainText("SSH 权限");
  });

  test("PW3-19 @pw3 按角色与 SSH 筛选成员", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "filter");
    await api.addMember(tokens.token, p.id, { username: "qa_dev", role: "developer" });

    await page.goto(`/projects/${p.id}/members`);
    await expect(page.getByTestId("member-row")).toHaveCount(2);

    await chooseSelect(page, "member-filter-role", "developer");
    await expect(page.getByTestId("member-row")).toHaveCount(1);
    await expect(page.getByTestId("member-row")).toContainText("开发");

    await chooseSelect(page, "member-filter-role", "all");
    await chooseSelect(page, "member-filter-ssh", "none");
    await expect(page.getByTestId("member-row")).toHaveCount(1);
    await expect(page.getByTestId("member-row")).toContainText("未开通");
  });

  test("PW3-09 @pw3 移除成员", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "rm");
    await api.addMember(tokens.token, p.id, { username: "qa_dev", role: "developer" });

    await page.goto(`/projects/${p.id}/members`);
    await expect(page.getByTestId("member-row")).toHaveCount(2);

    await page.getByTestId("member-remove").click();
    await page.getByRole("alertdialog").getByTestId("confirm-ok").click();

    await expect(page.getByTestId("member-row")).toHaveCount(1);
  });

  test("PW3-12 @pw3 owner 不可表单转让", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "no-owner");

    await page.goto(`/projects/${p.id}/members`);
    await openCreateDialog(page, "member-add-open");
    const roleSelect = page.getByTestId("member-role");
    await roleSelect.click();
    await expect(page.getByRole("option").filter({ hasText: "owner" })).toHaveCount(0);
    await expect(page.getByTestId("member-add-form")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("owner 不可通过此表单转让");
  });

  test("PW3-13 @pw3 admin 未选项目", async ({ pageAs }) => {
    const { page } = await pageAs("admin");
    await page.goto("/members");
    await expect(page.getByText("请选择要管理成员的项目")).toBeVisible();
  });
});
