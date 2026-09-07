import { test, expect } from "../fixtures/auth";
import { seedProjectWithMembers } from "../fixtures/seed";
import { openCreateDialog, chooseSelect } from "../helpers/dialog";

test.describe("PW-4 RBAC 成员建机权限", () => {
  test("PW4-19 @pw4 viewer 不能创建", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProjectWithMembers(ownerTokens.token, "ws-rb-v");

    const { page: viewerPage } = await pageAs("viewer");
    await viewerPage.goto(`/workspaces?project_id=${p.id}`);
    await openCreateDialog(viewerPage, "ws-create");
    await viewerPage.getByTestId("ws-submit").click();

    const err = viewerPage.getByTestId("ws-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("没有权限");
  });

  test("PW4-20 @pw4 developer 可创建", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProjectWithMembers(ownerTokens.token, "ws-rb-d");

    const { page: devPage } = await pageAs("dev");
    await devPage.goto(`/workspaces?project_id=${p.id}`);
    await openCreateDialog(devPage, "ws-create");
    await chooseSelect(devPage, "ws-plan-select", "nano");
    await chooseSelect(devPage, "ws-arch-select", "amd64");
    await devPage.getByTestId("ws-submit").click();

    const row = devPage.locator('[data-testid="ws-row"]');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-status", "requested");
    await expect(row).toContainText("待审批");
    await expect(row.getByTestId("ws-ssh-download")).not.toBeVisible();
    await expect(row.getByTestId("ws-approve")).not.toBeVisible();
  });
});
