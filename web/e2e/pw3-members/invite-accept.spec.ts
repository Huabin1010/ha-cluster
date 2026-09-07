import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject } from "../fixtures/seed";
import { uniqEmail } from "../helpers/ids";
import { openCreateDialog, chooseSelect } from "../helpers/dialog";

test.describe("PW-3 邀请与接受流程", () => {
  test("PW3-05 @pw3 生成邀请", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "inv");

    await page.goto(`/projects/${p.id}/members`);
    await openCreateDialog(page, "invite-open");
    await page.getByTestId("invite-email").fill(uniqEmail("inv"));
    await chooseSelect(page, "invite-role", "developer");
    await page.getByRole("dialog").getByRole("button", { name: "生成邀请" }).click();

    const box = page.getByTestId("invite-token");
    await expect(box).toBeVisible();
    const tokenText = await page.locator(".invite-token-text").textContent();
    expect(tokenText && tokenText.trim().length > 10).toBe(true);
  });

  test("PW3-06 @pw3 邀请链接", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "link-inv");

    await page.goto(`/projects/${p.id}/members`);
    await openCreateDialog(page, "invite-open");
    await page.getByTestId("invite-email").fill(uniqEmail("link"));
    await page.getByRole("dialog").getByRole("button", { name: "生成邀请" }).click();

    const acceptLink = page.getByTestId("invite-accept-link");
    await expect(acceptLink).toBeVisible();
    await acceptLink.click();

    await expect(page).toHaveURL(/\/invitations\/accept\?token=/);
    const tokenInput = page.getByTestId("accept-token");
    const val = await tokenInput.inputValue();
    expect(val.length).toBeGreaterThan(10);
  });

  test("PW3-07 @pw3 @smoke 接受邀请", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProject(ownerTokens.token, "acc");
    const inv = await api.createInvitation(ownerTokens.token, p.id, {
      email: "qa_dev@mnnumath.vip",
      role: "developer",
    });

    const { page: devPage } = await pageAs("dev");
    await devPage.goto(`/invitations/accept?token=${inv.token}`);
    await devPage.getByTestId("accept-submit").click();

    const ok = devPage.getByTestId("accept-ok");
    await expect(ok).toBeVisible();
    await expect(ok).toContainText("已接受");

    // 接受后自动跳转至该项目
    await expect(devPage).toHaveURL(new RegExp(`/projects/${p.id}`));
  });

  test("PW3-08 @pw3 错误 token", async ({ pageAs }) => {
    const { page } = await pageAs("dev");
    await page.goto("/invitations/accept?token=invalid-token-xyz-12345");
    await page.getByTestId("accept-submit").click();

    const err = page.getByTestId("accept-error");
    await expect(err).toBeVisible();
  });

  test("PW3-14 @pw3 @slow 邀请后成员可见项目", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProject(ownerTokens.token, "visible");
    const inv = await api.createInvitation(ownerTokens.token, p.id, {
      email: "qa_viewer@mnnumath.vip",
      role: "viewer",
    });

    // 由 viewer 接受邀请
    const { tokens: viewerTokens, page: viewerPage } = await pageAs("viewer");
    await api.acceptInvite(viewerTokens.token, inv.token);

    // viewer 打开项目列表
    await viewerPage.goto("/projects");
    await expect(viewerPage.locator("tr", { hasText: p.name })).toBeVisible();
  });

  test("PW3-15 @pw3 重复 accept", async ({ pageAs }) => {
    const { tokens: ownerTokens } = await pageAs("owner");
    const p = await seedProject(ownerTokens.token, "repeat");
    const inv = await api.createInvitation(ownerTokens.token, p.id, {
      email: "dev@mnnumath.vip",
      role: "developer",
    });

    // 第一次接受（通过 API）
    const { tokens: devTokens, page: devPage } = await pageAs("dev");
    await api.acceptInvite(devTokens.token, inv.token);

    // 第二次在页面提交相同 token
    await devPage.goto(`/invitations/accept?token=${inv.token}`);
    await devPage.getByTestId("accept-submit").click();

    const err = devPage.getByTestId("accept-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("冲突");
  });

  test("PW3-16 @pw3 邮箱格式", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "email-fmt");

    await page.goto(`/projects/${p.id}/members`);
    await openCreateDialog(page, "invite-open");
    const emailInput = page.getByTestId("invite-email");
    await emailInput.fill("not-an-email");

    const valid = await emailInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(valid).toBe(false);

    await page.getByRole("dialog").getByRole("button", { name: "生成邀请" }).click();
    await expect(page.getByTestId("invite-token")).not.toBeVisible();
  });
});
