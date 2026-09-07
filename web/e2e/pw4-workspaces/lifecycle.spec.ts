import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject, seedWorkspace } from "../fixtures/seed";
import { expectToast } from "../helpers/assert";
import { openCreateDialog, chooseSelect, confirmAlert } from "../helpers/dialog";

test.describe("PW-4 Workspace 生命周期", () => {
  test("PW4-01 @pw4 @smoke 空态", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-empty");
    await page.goto(`/workspaces?project_id=${p.id}`);

    const empty = page.getByTestId("empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("还没有服务器");
    await expect(page.getByTestId("ws-create")).toBeVisible();
  });

  test("PW4-02 @pw4 @smoke 创建 nano", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-create");
    await page.goto(`/workspaces?project_id=${p.id}`);

    await openCreateDialog(page, "ws-create");
    await chooseSelect(page, "ws-plan-select", "nano");
    await chooseSelect(page, "ws-arch-select", "amd64");
    await page.getByTestId("ws-submit").click();

    const row = page.locator('[data-testid="ws-row"][data-status="running"]');
    await expect(row).toBeVisible();
    await expectToast(page, "创建成功");
  });

  test("PW4-03 @pw4 项目 query 筛选", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const pA = await seedProject(tokens.token, "ws-flt-a");
    const pB = await seedProject(tokens.token, "ws-flt-b");
    await seedWorkspace(tokens.token, pA.id, { name: "ws-in-a" });
    await seedWorkspace(tokens.token, pB.id, { name: "ws-in-b" });

    await page.goto(`/workspaces?project_id=${pA.id}`);
    await expect(page.locator('[data-testid="ws-row"]', { hasText: "ws-in-a" })).toBeVisible();
    await expect(page.locator('[data-testid="ws-row"]', { hasText: "ws-in-b" })).not.toBeVisible();
  });

  test("PW4-04 @pw4 中文状态", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-status");
    await seedWorkspace(tokens.token, p.id, { name: "ws-running" });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-running" });
    await expect(row).toContainText("运行中");
  });

  test("PW4-05 @pw4 @smoke 停止", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-stop");
    await seedWorkspace(tokens.token, p.id, { name: "ws-to-stop" });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-to-stop" });
    await row.getByTestId("ws-stop").click();

    await expect(row).toHaveAttribute("data-status", "stopped");
    await expect(row).toContainText("仍占配额");
    await expectToast(page, "仍占配额");
  });

  test("PW4-06 @pw4 @smoke 再启动", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-start");
    const ws = await seedWorkspace(tokens.token, p.id, { name: "ws-to-start" });
    await api.stopWorkspace(tokens.token, ws.id);

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-to-start" });
    await expect(row).toHaveAttribute("data-status", "stopped");
    await row.getByTestId("ws-start").click();

    await expect(row).toHaveAttribute("data-status", "running");
  });

  test("PW4-07 @pw4 @smoke 销毁", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-dest");
    await seedWorkspace(tokens.token, p.id, { name: "ws-to-dest" });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-to-dest" });
    await row.getByTestId("ws-destroy").click();
    await confirmAlert(page, true);

    await expect(row).not.toBeVisible();
    await expectToast(page, "配额已归还");
  });

  test("PW4-08 @pw4 销毁取消", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-cancel");
    await seedWorkspace(tokens.token, p.id, { name: "ws-cancel-dest" });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-cancel-dest" });
    await row.getByTestId("ws-destroy").click();
    await confirmAlert(page, false);

    await expect(row).toBeVisible();
  });

  test("PW4-11 @pw4 visibility private", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-vis");

    await page.goto(`/workspaces?project_id=${p.id}`);
    await openCreateDialog(page, "ws-create");
    await chooseSelect(page, "ws-visibility-select", "private");
    await page.getByTestId("ws-submit").click();

    const row = page.getByTestId("ws-row").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("private");
  });

  test("PW4-14 @pw4 复制 workspace id", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-cpid");
    const ws = await seedWorkspace(tokens.token, p.id, { name: "ws-cpid-1" });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-cpid-1" });
    await row.getByTestId("ws-copy-id").click();

    await expectToast(page, "已复制");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(ws.id);
  });

  test("PW4-15 @pw4 创建中 disabled", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-busy");
    await page.goto(`/workspaces?project_id=${p.id}`);

    await page.route("**/api/projects/*/workspaces", async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });

    await openCreateDialog(page, "ws-create");
    const submitBtn = page.getByTestId("ws-submit");
    await submitBtn.click();

    await expect(submitBtn).toBeDisabled();
    await expect(submitBtn).toContainText("创建中…");
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  });

  test("PW4-16 @pw4 套餐下拉", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-plans");
    await page.goto(`/workspaces?project_id=${p.id}`);

    await openCreateDialog(page, "ws-create");
    const planSelect = page.getByTestId("ws-plan-select");
    await expect(planSelect).toBeVisible();
    await planSelect.click();
    const options = await page.getByRole("option").allTextContents();
    expect(options).toHaveLength(6);
    for (const expected of ["nano", "small", "2c2g", "medium", "large", "xlarge"]) {
      expect(options.some((txt) => txt.includes(expected))).toBe(true);
    }
  });

  test("PW4-18 @pw4 fabric_degraded 展示", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-deg");

    await page.route("**/api/workspaces*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "00000000-0000-0000-0000-000000000099",
                name: "ws-degraded-test",
                plan: "nano",
                arch: "amd64",
                status: "fabric_degraded",
                project_id: p.id,
                visibility: "shared",
              },
            ],
            total: 1,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-degraded-test" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("网络降级");
    await expect(row.getByTestId("ws-start")).toBeVisible();
    await expect(row.getByTestId("ws-stop")).toBeVisible();
    await expect(row.getByTestId("ws-ssh-download")).toBeVisible();
  });
});
