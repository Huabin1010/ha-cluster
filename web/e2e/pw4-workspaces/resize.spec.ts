import { test, expect } from "../fixtures/auth";
import { seedProject, seedProjectWithMembers, seedWorkspace } from "../fixtures/seed";
import { expectToast } from "../helpers/assert";

test.describe("PW-4 扩容申请与审批", () => {
  test("PW4-22 @pw4 @smoke 管理员升降配立即生效", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-rsz");
    await seedWorkspace(tokens.token, p.id, { name: "ws-to-grow", plan: "nano" });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-to-grow" });
    await expect(row).toBeVisible();
    await row.getByTestId("ws-resize").click();
    await page.getByTestId("ws-resize-cpu").fill("1");
    await page.getByTestId("ws-resize-mem").fill("1");
    await page.getByTestId("ws-resize-disk").fill("6");
    await page.getByTestId("ws-resize-submit").click();
    await expect(page.getByTestId("ws-resize-preview")).toBeVisible();
    await expect(page.getByTestId("ws-resize-preview")).toContainText("升配");
    await expect(page.getByTestId("ws-resize-confirm")).toHaveText("确认执行");
    await page.getByTestId("ws-resize-confirm").click();

    await expectToast(page, "已完成升配");
    await expect(row.getByTestId("ws-resize-pending")).toHaveCount(0);
    await expect(row).toContainText("1核");
  });

  test("PW4-23 @pw4 developer 申请扩容后管理员批准", async ({ pageAs }) => {
    const { tokens: ownerTokens, page: ownerPage } = await pageAs("owner");
    const p = await seedProjectWithMembers(ownerTokens.token, "ws-rsz-dev");
    await seedWorkspace(ownerTokens.token, p.id, { name: "ws-dev-grow", plan: "nano" });

    const { page: devPage } = await pageAs("dev");
    await devPage.goto(`/workspaces?project_id=${p.id}`);
    const devRow = devPage.locator('[data-testid="ws-row"]', { hasText: "ws-dev-grow" });
    await expect(devRow).toBeVisible();
    await devRow.getByTestId("ws-resize").click();
    await devPage.getByTestId("ws-resize-cpu").fill("1");
    await devPage.getByTestId("ws-resize-mem").fill("1");
    await devPage.getByTestId("ws-resize-disk").fill("6");
    await devPage.getByTestId("ws-resize-submit").click();
    await expect(devPage.getByTestId("ws-resize-preview")).toBeVisible();
    await devPage.getByTestId("ws-resize-confirm").click();
    await expect(devRow.getByTestId("ws-resize-pending")).toBeVisible();
    await expectToast(devPage, "扩容申请");

    await ownerPage.goto(`/workspaces?project_id=${p.id}`);
    const ownerRow = ownerPage.locator('[data-testid="ws-row"]', { hasText: "ws-dev-grow" });
    await ownerRow.getByTestId("ws-resize-approve").click();
    await expect(ownerRow.getByTestId("ws-resize-pending")).toHaveCount(0);
    await expectToast(ownerPage, "已批准扩容");
    await expect(ownerRow).toContainText("1核");
  });
});
