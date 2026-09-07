import { test, expect } from "../fixtures/auth";
import { seedProjectWithMembers } from "../fixtures/seed";

test.describe("PW-4 RBAC 成员建机权限", () => {
  test("PW4-19 @pw4 viewer 不能创建", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProjectWithMembers(ownerTokens.token, "ws-rb-v");

    const { page: viewerPage } = await pageAs("viewer");
    await viewerPage.goto(`/workspaces?project_id=${p.id}`);
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
    await devPage.getByTestId("ws-plan-select").selectOption("nano");
    await devPage.getByTestId("ws-arch-select").selectOption("amd64");
    await devPage.getByTestId("ws-submit").click();

    const row = devPage.locator('[data-testid="ws-row"]');
    await expect(row).toBeVisible();
  });
});
