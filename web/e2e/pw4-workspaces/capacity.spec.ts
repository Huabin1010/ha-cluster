import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { destroyWorkspaces, fillArch, seedProject } from "../fixtures/seed";
import { openCreateDialog, chooseSelect } from "../helpers/dialog";

test.describe("PW-4 容量与超卖拦截", () => {
  test("PW4-09 @pw4 @capacity 超卖 409", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-cap-409");
    const ids = await fillArch(tokens.token, p.id, "amd64");

    try {
      await page.goto(`/workspaces?project_id=${p.id}`);
      await openCreateDialog(page, "ws-create");
      await chooseSelect(page, "ws-plan-select", "nano");
      await chooseSelect(page, "ws-arch-select", "amd64");
      await page.getByTestId("ws-submit").click();

      const err = page.getByTestId("ws-error");
      await expect(err).toBeVisible();
      await expect(err).toContainText("资源不足");
      await expect(page.locator(".ws-insufficient")).toBeVisible();
    } finally {
      await destroyWorkspaces(tokens.token, ids);
    }
  });

  test("PW4-10 @pw4 @capacity arch 隔离", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-cap-iso");
    const ids = await fillArch(tokens.token, p.id, "arm64");

    try {
      await page.goto(`/workspaces?project_id=${p.id}`);
      await openCreateDialog(page, "ws-create");
      await chooseSelect(page, "ws-plan-select", "nano");
      await chooseSelect(page, "ws-arch-select", "arm64");
      await page.getByTestId("ws-name-input").fill("fail-arm64");
      await page.getByTestId("ws-submit").click();

      const err = page.getByTestId("ws-error");
      await expect(err).toBeVisible();
      await expect(err).toContainText("资源不足");

      await chooseSelect(page, "ws-arch-select", "amd64");
      await page.getByTestId("ws-name-input").fill("ok-amd64");
      await page.getByTestId("ws-submit").click();

      const row = page.locator('[data-testid="ws-row"]', { hasText: "ok-amd64" });
      await expect(row).toBeVisible();
    } finally {
      await destroyWorkspaces(tokens.token, ids);
    }
  });

  test("PW4-17 @pw4 @capacity 停止后再建同规格", async ({ pageAs }) => {
    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-cap-stop");
    const ids = await fillArch(tokens.token, p.id, "amd64");

    try {
      if (ids.length > 0) {
        await api.stopWorkspace(tokens.token, ids[0]);
      }

      await page.goto(`/workspaces?project_id=${p.id}`);
      await openCreateDialog(page, "ws-create");
      await chooseSelect(page, "ws-plan-select", "nano");
      await chooseSelect(page, "ws-arch-select", "amd64");
      await page.getByTestId("ws-submit").click();

      const err = page.getByTestId("ws-error");
      await expect(err).toBeVisible();
      await expect(err).toContainText("资源不足");
    } finally {
      await destroyWorkspaces(tokens.token, ids);
    }
  });
});
