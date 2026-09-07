import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject, seedWorkspace } from "../fixtures/seed";

test.describe("PW-4 SSH 配置下载与权限", () => {
  test("PW4-12 @pw4 @smoke 下载 SSH", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-ssh");
    await seedWorkspace(tokens.token, p.id, { name: "ws-ssh-dl" });

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-ssh-dl" });
    await expect(row).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      row.getByTestId("ws-ssh-download").click(),
    ]);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (stream) {
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
    }
    const content = Buffer.concat(chunks).toString("utf-8");
    expect(content).toContain("Host ha-");
    expect(content).toContain("RemoteCommand");
  });

  test("PW4-13 @pw4 stopped 无 SSH 按钮", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-nossh");
    const ws = await seedWorkspace(tokens.token, p.id, { name: "ws-stopped-nossh" });
    await api.stopWorkspace(tokens.token, ws.id);

    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-stopped-nossh" });
    await expect(row).toHaveAttribute("data-status", "stopped");
    await expect(row.getByTestId("ws-ssh-download")).not.toBeVisible();
  });
});
