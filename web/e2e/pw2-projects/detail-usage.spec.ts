import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject, seedWorkspace } from "../fixtures/seed";

test.describe("PW-2 项目详情与用量", () => {
  test("PW2-06 @pw2 用量展示", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "usage");
    await seedWorkspace(tokens.token, p.id, { plan: "nano", arch: "amd64" });

    const u = await api.usage(tokens.token, p.id);

    await page.goto(`/projects/${p.id}`);
    const usageGrid = page.getByTestId("project-usage");
    await expect(usageGrid).toBeVisible();
    await expect(usageGrid).toContainText(String(u.workspaces));
    expect(u.workspaces).toBe(1);
  });

  test("PW2-10 @pw2 去创建 Workspace 链", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "link");

    await page.goto(`/projects/${p.id}`);
    const link = page.getByTestId("project-goto-workspaces");
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/workspaces\\?project_id=${p.id}`));
    const select = page.getByTestId("ws-filter-project");
    await expect(select).toHaveAttribute("data-value", p.id);
  });
});
