import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject } from "../fixtures/seed";

test.describe("PW-3 权限控制与界面交互", () => {
  test("PW3-10 @pw3 @smoke viewer 不能加成员", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProject(ownerTokens.token, "v-add");
    await api.addMember(ownerTokens.token, p.id, { username: "qa_viewer", role: "viewer" });

    const { page: viewerPage } = await pageAs("viewer");
    await viewerPage.goto(`/projects/${p.id}/members`);

    await expect(viewerPage.getByTestId("member-table")).toBeVisible();
    await expect(viewerPage.getByTestId("member-add-open")).toHaveCount(0);
    await expect(viewerPage.getByTestId("invite-open")).toHaveCount(0);
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

  test("PW3-14 @pw3 @smoke 普通用户看不到全局成员页", async ({ ownerPage }) => {
    await ownerPage.goto("/projects");
    await expect(ownerPage.getByTestId("nav-members")).toHaveCount(0);

    await ownerPage.goto("/members");
    const forbidden = ownerPage.getByTestId("members-forbidden");
    await expect(forbidden).toBeVisible();
    await expect(forbidden).toContainText("无权查看全局成员页");
  });
});
