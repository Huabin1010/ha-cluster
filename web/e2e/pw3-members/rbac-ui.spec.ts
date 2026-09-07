import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject } from "../fixtures/seed";
import { openCreateDialog } from "../helpers/dialog";

test.describe("PW-3 权限控制与界面交互", () => {
  test("PW3-10 @pw3 @smoke viewer 不能加成员", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProject(ownerTokens.token, "v-add");
    await api.addMember(ownerTokens.token, p.id, { username: "qa_viewer", role: "viewer" });

    const { page: viewerPage } = await pageAs("viewer");
    await viewerPage.goto(`/projects/${p.id}/members`);

    await openCreateDialog(viewerPage, "member-add-open");
    await viewerPage.getByTestId("member-username").fill("another_user");
    await viewerPage.getByTestId("member-add").click();

    const err = viewerPage.getByTestId("member-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("没有权限");
  });

  test("PW3-11 @pw3 viewer 不能移除", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProject(ownerTokens.token, "v-rm");
    await api.addMember(ownerTokens.token, p.id, { username: "qa_viewer", role: "viewer" });
    await api.addMember(ownerTokens.token, p.id, { username: "qa_dev", role: "developer" });

    const { page: viewerPage } = await pageAs("viewer");
    await viewerPage.goto(`/projects/${p.id}/members`);

    // viewer 尝试点击移除 developer
    viewerPage.once("dialog", (d) => d.accept());
    const rmBtns = viewerPage.getByTestId("member-remove");
    await expect(rmBtns.first()).toBeVisible();
    await rmBtns.first().click();

    const err = viewerPage.getByTestId("member-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("没有权限");
  });
});
