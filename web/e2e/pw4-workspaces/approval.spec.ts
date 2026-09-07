import { test, expect } from "../fixtures/auth";
import { seedProjectWithMembers } from "../fixtures/seed";
import { openCreateDialog, chooseSelect } from "../helpers/dialog";
import { expectToast } from "../helpers/assert";

test.describe("PW-4 服务器申请与审批", () => {
  test("PW4-21 @pw4 @smoke developer 申请后 owner 批准才给连接", async ({ pageAs }) => {
    const { tokens: ownerTokens, page: ownerPage } = await pageAs("owner");
    const p = await seedProjectWithMembers(ownerTokens.token, "ws-appr");

    const { page: devPage } = await pageAs("dev");
    await devPage.goto(`/workspaces?project_id=${p.id}`);
    await openCreateDialog(devPage, "ws-create");
    await chooseSelect(devPage, "ws-plan-select", "nano");
    await chooseSelect(devPage, "ws-arch-select", "amd64");
    await devPage.getByTestId("ws-name-input").fill("need-approve");
    await devPage.getByTestId("ws-submit").click();

    const devRow = devPage.locator('[data-testid="ws-row"]', { hasText: "need-approve" });
    await expect(devRow).toBeVisible();
    await expect(devRow).toHaveAttribute("data-status", "requested");
    await expect(devRow.getByTestId("ws-copy-ssh")).not.toBeVisible();

    await ownerPage.goto(`/workspaces?project_id=${p.id}`);
    const ownerRow = ownerPage.locator('[data-testid="ws-row"]', { hasText: "need-approve" });
    await expect(ownerRow).toBeVisible();
    await expect(ownerPage.getByTestId("ws-pending-banner")).toContainText("待审批");
    await ownerRow.getByTestId("ws-approve").click();
    await expect(ownerRow).toHaveAttribute("data-status", "running");
    await expectToast(ownerPage, "已批准");

    await expect(ownerRow.getByTestId("ws-copy-ssh")).toBeVisible();
    await expect(ownerRow.getByTestId("ws-import-key")).toBeVisible();

    await devPage.reload();
    await expect(devRow).toHaveAttribute("data-status", "running");
    await expect(devRow.getByTestId("ws-copy-ssh")).toBeVisible();
  });
});
