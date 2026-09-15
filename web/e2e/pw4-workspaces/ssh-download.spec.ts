import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject, seedWorkspace } from "../fixtures/seed";

test.describe("PW-4 HTTP 执行入口与权限", () => {
  test("PW4-12 @pw4 @smoke 列表提供网页终端", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-ssh");
    await seedWorkspace(tokens.token, p.id, { name: "ws-ssh-dl" });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-ssh-dl" });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("ws-web-terminal")).toBeVisible();
    await expect(row.getByTestId("ws-ssh-download")).toHaveCount(0);
    await expect(row.getByTestId("ws-copy-ssh")).toHaveCount(0);
  });

  test("PW4-13 @pw4 stopped 无连接按钮", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-nossh");
    const ws = await seedWorkspace(tokens.token, p.id, { name: "ws-stopped-nossh" });
    await api.stopWorkspace(tokens.token, ws.id);

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-stopped-nossh" });
    await expect(row).toHaveAttribute("data-status", "stopped");
    await expect(row.getByTestId("ws-copy-http-exec")).not.toBeVisible();
    await expect(row.getByTestId("ws-web-terminal")).not.toBeVisible();
  });
});
