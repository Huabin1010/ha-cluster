import { expect } from "@playwright/test";
import { test } from "../e2e/fixtures/auth";
import { seedProject } from "../e2e/fixtures/seed";
import { uniq } from "../e2e/helpers/ids";
import { api } from "../e2e/helpers/api";
import { generateSSHKeyPair, getIncusContainerInfo, runCmd } from "./helpers";
import { openCreateDialog, chooseSelect } from "../e2e/helpers/dialog";

test.describe("Real Machine: 03 真机 Incus 容器创建、真实 SSH 连通与生命周期", () => {
  test("REAL-WS-01 从 UI 创建真实 Incus 容器并通过私钥执行真机 SSH 交互", async ({ pageAs }) => {
    const { page: ownerPage, tokens } = await pageAs("owner");

    // 1. 生成真实 ED25519 密钥对并上传至控制台
    const keyPair = generateSSHKeyPair("real_ws_ssh");
    const keyName = uniq("key-ws");

    await ownerPage.goto("/settings/keys");
    await openCreateDialog(ownerPage, "keys-add-open");
    await expect(ownerPage.locator("[data-testid=keys-name]")).toBeVisible({ timeout: 15_000 });
    await ownerPage.fill("[data-testid=keys-name]", keyName);
    await ownerPage.fill("[data-testid=keys-pubkey]", keyPair.publicKey);
    await ownerPage.click("[data-testid=keys-add]");
    await expect(ownerPage.locator("table tbody tr", { hasText: keyName })).toBeVisible({ timeout: 15_000 });

    // 2. 准备项目
    const p = await seedProject(tokens.token, "prj-real");

    // 3. 前往 /workspaces?project_id=xxx 创建真实 amd64 容器
    const wsName = uniq("ws-real");
    await ownerPage.goto(`/workspaces?project_id=${p.id}`);
    await expect(ownerPage.getByTestId("ws-create")).toBeVisible({ timeout: 15_000 });
    await openCreateDialog(ownerPage, "ws-create");

    await ownerPage.getByTestId("ws-name-input").fill(wsName);
    await chooseSelect(ownerPage, "ws-plan-select", "nano");
    await chooseSelect(ownerPage, "ws-arch-select", "amd64");

    // 提交创建（后端通过 IncusRuntime 实际调用 incus launch）
    await ownerPage.getByTestId("ws-submit").click();

    // 等待 UI 中出现并进入运行中状态
    const wsRow = ownerPage.locator("tr[data-testid=ws-row]", { hasText: wsName });
    await expect(wsRow).toBeVisible({ timeout: 45_000 });
    await expect(wsRow).toContainText("运行中", { timeout: 30_000 });

    // 4. 验证真实 Incus 容器已启动
    // 从 API 获取该 workspace
    const listRes = await api.listWorkspaces(tokens.token, p.id);
    const ws = listRes.data.find((w: any) => w.name === wsName);
    expect(ws).toBeTruthy();
    const shortId = ws!.id.slice(0, 8);
    const containerName = `ha-${shortId}`;

    // 探测 incus 中的真实状态
    const container = await getIncusContainerInfo(shortId);
    expect(container).not.toBeNull();
    expect(container!.state).toBe("RUNNING");
    expect(container!.ip).toMatch(/^10\.99\.0\.\d+$/);

    // 5. 真实动作：使用私钥通过 SSH 直接连入容器并执行命令
    const containerIp = container!.ip;
    const sshCmd = `ssh -i ${keyPair.privateKeyPath} -o BatchMode=yes -o StrictHostKeyChecking=no root@${containerIp} "echo REAL_CONTAINER_UP && hostname && uname -a"`;
    const { stdout: sshOut } = await runCmd(sshCmd);
    expect(sshOut).toContain("REAL_CONTAINER_UP");
    expect(sshOut).toContain(containerName);

    // 在容器内真实写入文件并读回，检验真实容器文件系统
    const writeCmd = `ssh -i ${keyPair.privateKeyPath} -o BatchMode=yes -o StrictHostKeyChecking=no root@${containerIp} "echo 'cluster-real-2026' > /root/verify.txt && cat /root/verify.txt"`;
    const { stdout: fileOut } = await runCmd(writeCmd);
    expect(fileOut).toContain("cluster-real-2026");

    // 6. 测试 UI 触发 SSH 配置下载
    const [download] = await Promise.all([
      ownerPage.waitForEvent("download"),
      wsRow.locator("[data-testid=ws-ssh-download]").click(),
    ]);
    expect(download.suggestedFilename()).toBe(`ha-${shortId}.config`);

    // 7. 在 UI 中停止容器 (ws-stop)
    await wsRow.locator("[data-testid=ws-stop]").click();
    await expect(wsRow).toContainText("已停止", { timeout: 30_000 });

    // 验证 Incus 中容器确实变成 STOPPED
    const stoppedInfo = await getIncusContainerInfo(shortId);
    expect(stoppedInfo!.state).toBe("STOPPED");

    // 8. 在 UI 中启动容器 (ws-start)
    await wsRow.locator("[data-testid=ws-start]").click();
    await expect(wsRow).toContainText("运行中", { timeout: 30_000 });

    const restartedInfo = await getIncusContainerInfo(shortId);
    expect(restartedInfo!.state).toBe("RUNNING");

    // 9. 在 UI 中销毁容器 (ws-destroy)
    ownerPage.once("dialog", (dialog) => dialog.accept());
    await wsRow.locator("[data-testid=ws-destroy]").click();
    await expect(wsRow).not.toBeVisible({ timeout: 30_000 });

    // 验证 Incus 中容器已被彻底删除
    const deletedInfo = await getIncusContainerInfo(shortId);
    expect(deletedInfo).toBeNull();
  });
});
