import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject } from "../fixtures/seed";

test.describe("PW-2 项目预算与拦截", () => {
  test("PW2-07 @pw2 编辑预算", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "bgt");

    await page.goto(`/projects/${p.id}`);
    const memIn = page.getByTestId("budget-mem");
    await memIn.fill("1073741824"); // 1GiB
    await page.getByTestId("budget-save").click();

    await expect(page.locator(".ok")).toContainText("预算已保存");

    // 重新加载验证持久化
    await page.reload();
    await expect(page.getByTestId("budget-mem")).toHaveValue("1073741824");
  });

  test("PW2-08 @pw2 预算 0=不限", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "zero");

    await page.goto(`/projects/${p.id}`);
    await page.getByTestId("budget-cpu").fill("0");
    await page.getByTestId("budget-mem").fill("0");
    await page.getByTestId("budget-disk").fill("0");
    await page.getByTestId("budget-save").click();

    await expect(page.locator(".ok")).toContainText("预算已保存");
    await page.reload();
    await expect(page.getByTestId("budget-mem")).toHaveValue("0");
    await expect(page.locator(".project-detail")).toContainText("不限");
  });

  test("PW2-09 @pw2 @smoke 预算拦截", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "intercept");

    // 限制内存预算为极小值（1 字节）
    await api.patchBudget(tokens.token, p.id, { budget_mem_bytes: 1 });

    // 前往创建 workspace 页面
    await page.goto(`/workspaces?project_id=${p.id}`);
    await page.getByRole("button", { name: "创建 Workspace" }).click();

    // 断言出现 409 资源不足错误提示
    const err = page.getByTestId("ws-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("资源不足");

    const banner = page.locator(".ws-insufficient");
    await expect(banner).toBeVisible();
  });
});
