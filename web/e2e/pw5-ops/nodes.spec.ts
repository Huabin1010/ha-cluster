import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { expectToast } from "../helpers/assert";

test.describe("PW-5 节点与 Fabric 运维", () => {
  test("PW5-01 @pw5 @smoke 节点列表可加载", async ({ pageAs }) => {
    const nodeName = `e2e-seed-${Date.now()}`;
    await api.heartbeat({
      name: nodeName,
      arch: "amd64",
      role: "worker",
      ready: true,
      fabric_ip: "10.88.0.201",
    });

    const { page } = await pageAs("owner");
    await page.goto("/nodes");

    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(page.locator('[data-testid="node-row"]', { hasText: nodeName })).toBeVisible();
  });

  test("PW5-02 @pw5 @smoke 有心跳节点", async ({ pageAs }) => {
    const nodeName = `e2e-node-${Date.now()}`;
    await api.heartbeat({
      name: nodeName,
      arch: "amd64",
      role: "control-plane",
      ready: true,
      fabric_ip: "10.88.0.210",
    });

    const { page } = await pageAs("owner");
    await page.goto("/nodes");

    const row = page.locator('[data-testid="node-row"]', { hasText: nodeName });
    await expect(row).toBeVisible();

    const readyBadge = row.getByTestId("node-ready");
    await expect(readyBadge).toHaveText("yes");
    await expect(readyBadge).toHaveClass(/badge-ok/);
  });

  test("PW5-03 @pw5 Ready false / stale 样式", async ({ pageAs }) => {
    const { page } = await pageAs("owner");

    await page.route("**/api/nodes*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [
              {
                id: "mock-degraded-node",
                name: "mock-degraded",
                arch: "amd64",
                power: "mains",
                ready: false,
                fabric_ip: "10.88.0.99",
                fabric_path: "stale",
                fabric_rtt_ms: 50,
                used_mem_bytes: 0,
                allocatable_mem_bytes: 1024,
              },
            ],
            total: 1,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/nodes");
    const row = page.locator('[data-testid="node-row"]', { hasText: "mock-degraded" });
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/warn-row/);

    const readyBadge = row.getByTestId("node-ready");
    await expect(readyBadge).toHaveClass(/badge-danger/);
    await expect(readyBadge).toHaveText("no");

    const pathBadge = row.locator(".badge-warn");
    await expect(pathBadge).toBeVisible();
  });

  test("PW5-04 @pw5 列完整", async ({ pageAs }) => {
    const nodeName = `e2e-node-cols-${Date.now()}`;
    await api.heartbeat({
      name: nodeName,
      arch: "amd64",
      role: "control-plane",
      ready: true,
      fabric_ip: "10.88.0.215",
      fabric_path: "p2p",
      fabric_rtt_ms: 12,
    });

    const { page } = await pageAs("owner");
    await page.goto("/nodes");

    const row = page.locator('[data-testid="node-row"]', { hasText: nodeName });
    await expect(row).toBeVisible();
    await expect(row).toContainText("10.88.0.215");
    await expect(row).toContainText("p2p");
    await expect(row).toContainText("12 ms");
  });

  test("PW5-12 @pw5 @capacity 对账按钮", async ({ adminPage }) => {
    await adminPage.goto("/nodes");
    const btn = adminPage.getByTestId("nodes-reconcile");
    await expect(btn).toBeVisible();
    await btn.click();

    await expectToast(adminPage, "对账完成");
  });

  test("PW5-13 @pw5 非 admin 无对账", async ({ ownerPage }) => {
    await ownerPage.goto("/nodes");
    await expect(ownerPage.getByTestId("nodes-reconcile")).not.toBeVisible();
  });

  test("PW5-16 @pw5 节点刷新", async ({ pageAs }) => {
    const nodeName = `e2e-node-rf-${Date.now()}`;
    await api.heartbeat({
      name: nodeName,
      arch: "amd64",
      role: "control-plane",
      ready: true,
      fabric_ip: "10.88.0.220",
    });

    const { page } = await pageAs("owner");
    await page.goto("/nodes");
    const row = page.locator('[data-testid="node-row"]', { hasText: nodeName });
    await expect(row).toContainText("10.88.0.220");

    // 更新心跳中的 fabric_ip
    await api.heartbeat({
      name: nodeName,
      arch: "amd64",
      role: "control-plane",
      ready: true,
      fabric_ip: "10.88.0.225",
    });

    await page.reload();
    await expect(row).toContainText("10.88.0.225");
  });
});
