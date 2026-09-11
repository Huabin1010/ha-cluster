import { test, expect } from "../fixtures/auth";
import { seedProject, seedWorkspace } from "../fixtures/seed";

test.describe("PW-4 机器连接与域名", () => {
  test("PW4-23 @pw4 @smoke 详情页复制 SSH 并接入域名", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-ing");
    const ws = await seedWorkspace(tokens.token, p.id, { name: "ws-web", plan: "nano" });

    await page.goto(`/workspaces/${ws.id}/connect`);
    await expect(page.locator("main h2")).toContainText("ws-web");
    const cmd = page.getByTestId("ws-ssh-cmd");
    await expect(cmd).toBeVisible();
    await expect(cmd).toContainText("ssh");
    await expect(page.getByTestId("ws-web-terminal")).toBeVisible();
    await page.getByTestId("ws-copy-ssh").click();

    await page.goto(`/workspaces/${ws.id}/ingress`);
    await page.getByTestId("ing-add").click();
    await page.getByTestId("ing-domain").fill("app.example.com");
    await page.getByTestId("ing-port").fill("8080");
    await expect(page.getByTestId("ing-submit")).toBeEnabled();
    await page.getByTestId("ing-submit").click();
    await expect(page.getByTestId("ing-row")).toContainText("app.example.com");
    await expect(page.getByTestId("ing-row")).toContainText("nocache");

    await page.goto(`/workspaces/${ws.id}/history`);
    await expect(page.getByTestId("ws-audit-table")).toBeVisible();
    await expect(page.getByTestId("ws-audit-table")).toContainText(/开通|申请|接入/);
  });
});
