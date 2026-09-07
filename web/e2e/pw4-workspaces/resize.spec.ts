import { test, expect } from "../fixtures/auth";
import { seedProject, seedWorkspace } from "../fixtures/seed";
import { expectToast } from "../helpers/assert";

test.describe("PW-4 扩容申请与审批", () => {
  test("PW4-22 @pw4 @smoke 申请扩容后管理员批准", async ({ pageAs }) => {
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

    await expect(row.getByTestId("ws-resize-pending")).toBeVisible();
    await expectToast(page, "扩容申请");

    await row.getByTestId("ws-resize-approve").click();
    await expect(row.getByTestId("ws-resize-pending")).toHaveCount(0);
    await expectToast(page, "已批准扩容");
    await expect(row).toContainText("1核");
  });
});
