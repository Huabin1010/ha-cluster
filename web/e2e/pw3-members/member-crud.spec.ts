import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject } from "../fixtures/seed";

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
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "query");

    await page.goto(`/members?project_id=${p.id}`);
    const select = page.getByTestId("member-project");
    await expect(select).toHaveValue(p.id);

    await expect(page.getByTestId("member-table")).toBeVisible();
  });

  test("PW3-03 @pw3 @smoke owner 加 developer", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "add-dev");

    await page.goto(`/projects/${p.id}/members`);
    await page.getByTestId("member-username").fill("qa_dev");
    await page.getByTestId("member-role").selectOption("developer");
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
    await expect(help).toContainText("viewer");
    await expect(help).toContainText("developer");
    await expect(help).toContainText("admin");
    await expect(help).toContainText("owner");
  });

  test("PW3-09 @pw3 移除成员", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "rm");
    await api.addMember(tokens.token, p.id, { username: "qa_dev", role: "developer" });

    await page.goto(`/projects/${p.id}/members`);
    await expect(page.getByTestId("member-row")).toHaveCount(2);

    page.once("dialog", (d) => d.accept());
    await page.getByTestId("member-remove").click();

    await expect(page.getByTestId("member-row")).toHaveCount(1);
  });

  test("PW3-12 @pw3 owner 不可表单转让", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "no-owner");

    await page.goto(`/projects/${p.id}/members`);
    const roleSelect = page.getByTestId("member-role");
    const options = await roleSelect.locator("option").allTextContents();
    expect(options.some((txt) => txt.includes("owner"))).toBe(false);

    await expect(page.locator(".members-panel")).toContainText("owner 不可通过此表单转让");
  });

  test("PW3-13 @pw3 未选项目", async ({ pageAs }) => {
    const { page } = await pageAs("owner");
    await page.goto("/members");
    await expect(page.locator("section")).toContainText("从上方选择项目");
  });
});
