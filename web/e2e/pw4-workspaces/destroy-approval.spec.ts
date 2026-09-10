import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject, seedWorkspace } from "../fixtures/seed";
import { confirmAlert } from "../helpers/dialog";

test.describe("PW-4 销毁双层审批", () => {
  test("PW4-20 @pw4 状态标签", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-dest-st");
    const ws = await seedWorkspace(tokens.token, p.id, { name: "ws-dest-label" });

    await api.requestDestroyWorkspace(tokens.token, ws.id);
    await page.goto(`/workspaces?project_id=${p.id}`);
    const row = page.locator('[data-testid="ws-row"]', { hasText: "ws-dest-label" });
    await expect(row).toContainText("待销毁审批");
  });
});
