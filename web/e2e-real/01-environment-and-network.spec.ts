import { expect } from "@playwright/test";
import { test } from "../e2e/fixtures/auth";
import { runCmd } from "./helpers";

test.describe("Real Machine: 01 物理与网络环境验证", () => {
  test("REAL-NET-01 EasyTier 虚网与 VPS 中枢连通性", async () => {
    // 检查 host 上 easytier 接口存在
    const { stdout: ipOut } = await runCmd("ip a show easytier");
    expect(ipOut).toContain("10.88.0.30");

    // ping VPS 中枢 10.88.0.1
    const { stdout: pingOut } = await runCmd("ping -c 2 -W 2 10.88.0.1");
    expect(pingOut).toContain("2 received");
  });

  test("REAL-INCUS-01 Incus 守护进程与本地工作区镜像完备性", async () => {
    // 检查 incus 可用
    const { stdout: listOut } = await runCmd("incus list");
    expect(listOut).toContain("NAME");

    // 检查本地已有 ha-ubuntu-24.04 镜像
    const { stdout: imgOut } = await runCmd("incus image list");
    expect(imgOut).toContain("ha-ubuntu-24.04");
  });

  test("REAL-UI-01 管理员在控制台查验真实宿主机节点 dev-pc", async ({ adminPage }) => {
    await adminPage.goto("/nodes");
    const devPcRow = adminPage.locator("[data-testid=node-row]", { hasText: "dev-pc" });
    await expect(devPcRow).toBeVisible({ timeout: 15_000 });
    await expect(devPcRow).toContainText("amd64");
    await expect(devPcRow).toContainText("10.88.0.30");
    await expect(devPcRow.locator("[data-testid=node-ready]")).toHaveText("yes");
  });

  test("REAL-UI-02 真实容量池 free 统计非零且可调度", async ({ adminPage }) => {
    await adminPage.goto("/capacity");
    const amd64Row = adminPage.locator("[data-testid=capacity-row]", { hasText: "amd64" });
    await expect(amd64Row).toBeVisible({ timeout: 15_000 });
    await expect(amd64Row).not.toContainText("0 mCPU");
  });
});
