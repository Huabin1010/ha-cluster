import { expect } from "@playwright/test";
import { test } from "../e2e/fixtures/auth";
import { api } from "../e2e/helpers/api";
import { uniq, uniqEmail } from "../e2e/helpers/ids";
import { openCreateDialog, chooseSelect } from "../e2e/helpers/dialog";
import { generateSSHKeyPair, getIncusContainerInfo, runCmd } from "./helpers";

test.describe("Real Machine & Container: 端到端完整用户流程（User Journey）", () => {
  test("JOURNEY-FLOW-01 完整用户旅程：从管理员核验、用户注册、项目配额、团队协作、SSH密钥录入到真实Incus容器全生命周期与审计对账", async ({
    adminPage,
    pageAs,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000); // 真机创建与容器 SSH 测试给予充足的 3 分钟超时缓冲

    const ts = Date.now();
    const ownerName = `jou_owner_${ts.toString().slice(-6)}`;
    const ownerEmail = uniqEmail("owner");
    const ownerPass = "Password123!";

    // ==========================================
    // 阶段一：管理员登录与集群初始健康校验
    // ==========================================
    // 发送活跃心跳确保真实节点 dev-pc 始终保持最新 Ready 状态
    await api.heartbeat({
      name: "dev-pc",
      arch: "amd64",
      role: "worker",
      allocatable_cpu_milli: 8000,
      allocatable_mem_bytes: 8 * 1024 * 1024 * 1024,
      allocatable_disk_bytes: 200 * 1024 * 1024 * 1024,
    });

    await adminPage.goto("/nodes");
    const devPcRow = adminPage.locator("[data-testid=node-row]", { hasText: "dev-pc" });
    await expect(devPcRow).toBeVisible({ timeout: 15_000 });
    await expect(devPcRow).toContainText("amd64");
    await expect(devPcRow.locator("[data-testid=node-ready]")).toHaveText("yes");

    await adminPage.goto("/capacity");
    const amd64Row = adminPage.locator("[data-testid=capacity-row]", { hasText: "amd64" });
    await expect(amd64Row).toBeVisible({ timeout: 15_000 });
    await expect(amd64Row).not.toContainText("0 mCPU");

    // ==========================================
    // 阶段二：全新用户注册与独立会话建立
    // ==========================================
    await api.register(ownerName, ownerEmail, ownerPass);
    const ownerTokens = await api.login(ownerName, ownerPass);

    const ownerContext = await browser.newContext({
      baseURL,
      permissions: ["clipboard-read", "clipboard-write"],
      storageState: {
        cookies: [],
        origins: [
          {
            origin: baseURL ?? "http://127.0.0.1:5173",
            localStorage: [
              { name: "ha_token", value: ownerTokens.token },
              { name: "ha_refresh", value: ownerTokens.refresh_token },
              { name: "ha_user", value: JSON.stringify(ownerTokens.user) },
            ],
          },
        ],
      },
    });
    const ownerPage = await ownerContext.newPage();

    // 访问项目首页，验证初次空态
    await ownerPage.goto("/projects");
    await expect(ownerPage.locator("h2")).toContainText("项目");

    // ==========================================
    // 阶段三：项目生命周期与配额管控
    // ==========================================
    const projName = `演示项目_${ts.toString().slice(-6)}`;
    const projSlug = `proj-${ts.toString().slice(-6)}`;

    await openCreateDialog(ownerPage, "project-create-open");
    await ownerPage.fill("[data-testid=project-name]", projName);
    await ownerPage.fill("[data-testid=project-slug]", projSlug);
    await ownerPage.click("[data-testid=project-create]");

    // 创建成功后自动跳转至 /projects/:id
    await expect(ownerPage).toHaveURL(/\/projects\/[0-9a-f-]+/, { timeout: 15_000 });
    const projUrl = ownerPage.url();
    const projId = projUrl.split("/").pop()!;
    expect(projId).toBeTruthy();

    // 配置项目预算配额：4000 mCPU, 4GiB (4294967296 bytes), 50GiB (53687091200 bytes)
    await ownerPage.fill("[data-testid=budget-cpu]", "4000");
    await ownerPage.fill("[data-testid=budget-mem]", "4294967296");
    await ownerPage.fill("[data-testid=budget-disk]", "53687091200");
    await ownerPage.click("[data-testid=budget-save]");
    await expect(ownerPage.locator(".ok")).toBeVisible({ timeout: 10_000 });

    // 检查初始用量为 0
    const usageGrid = ownerPage.locator("[data-testid=project-usage]");
    await expect(usageGrid).toBeVisible({ timeout: 10_000 });
    await expect(usageGrid).toContainText("CPU0");

    // ==========================================
    // 阶段四：团队协作与 RBAC 细粒度权限
    // ==========================================
    // Owner 前往成员页面发起邀请（指定受邀人为预置开发者 qa_dev@mnnumath.vip）
    await ownerPage.goto(`/projects/${projId}/members`);
    const devEmail = "qa_dev@mnnumath.vip";
    await openCreateDialog(ownerPage, "invite-open");
    await ownerPage.fill("[data-testid=invite-email]", devEmail);
    await chooseSelect(ownerPage, "invite-role", "developer");
    await ownerPage.getByRole("dialog").getByRole("button", { name: "生成邀请" }).click();

    const tokenBox = ownerPage.locator("[data-testid=invite-token]");
    await expect(tokenBox).toBeVisible({ timeout: 10_000 });
    const inviteToken = (await ownerPage.locator(".invite-token-text").textContent())?.trim() ?? "";
    expect(inviteToken.length).toBeGreaterThan(10);

    // 开发者账号接受邀请加入项目
    const { page: devPage } = await pageAs("dev");
    await devPage.goto(`/invitations/accept?token=${inviteToken}`);
    await devPage.click("[data-testid=accept-submit]");
    await expect(devPage.locator("[data-testid=accept-ok]")).toBeVisible({ timeout: 15_000 });

    // 验证开发者视角：可看到工作区创建入口；尝试修改预算时被系统权限拦截
    await devPage.goto(`/projects/${projId}`);
    await expect(devPage.locator("[data-testid=project-goto-workspaces]")).toBeVisible({ timeout: 15_000 });
    await devPage.fill("[data-testid=budget-cpu]", "9999");
    await devPage.click("[data-testid=budget-save]");
    const devErr = devPage.locator("[data-testid=project-error]");
    await expect(devErr).toBeVisible({ timeout: 10_000 });
    await expect(devErr).toContainText("没有权限");

    // ==========================================
    // 阶段五：开发者凭证与 SSH 密钥管理
    // ==========================================
    const keyPair = generateSSHKeyPair("journey_ws_ssh");
    const keyName = uniq("key-journey");

    await ownerPage.goto("/settings/keys");
    await openCreateDialog(ownerPage, "keys-add-open");
    await expect(ownerPage.locator("[data-testid=keys-name]")).toBeVisible({ timeout: 15_000 });
    await ownerPage.fill("[data-testid=keys-name]", keyName);
    await ownerPage.fill("[data-testid=keys-pubkey]", keyPair.publicKey);
    await ownerPage.click("[data-testid=keys-add]");
    await expect(ownerPage.locator("[data-testid=keys-row]", { hasText: keyName })).toBeVisible({ timeout: 15_000 });

    // API 层双重验证该公钥已成功绑定至 owner 账号
    const myKeys = await api.listSSHKeys(ownerTokens.token);
    expect(myKeys.data.some((k) => k.name === keyName)).toBe(true);

    // ==========================================
    // 阶段六：真实工作区（Workspace）创建与 Incus 调度
    // ==========================================
    const wsName = uniq("ws-jou");
    await ownerPage.goto(`/workspaces?project_id=${projId}`);
    await expect(ownerPage.getByTestId("ws-create")).toBeVisible({ timeout: 15_000 });
    await openCreateDialog(ownerPage, "ws-create");

    await ownerPage.getByTestId("ws-name-input").fill(wsName);
    await chooseSelect(ownerPage, "ws-plan-select", "nano");
    await chooseSelect(ownerPage, "ws-arch-select", "amd64");

    // 提交创建（后端真实通过挂载的 Incus Socket 调用 incus launch）
    await ownerPage.getByTestId("ws-submit").click();

    // 等待 UI 中出现并进入运行中状态
    const wsRow = ownerPage.locator("tr[data-testid=ws-row]", { hasText: wsName });
    await expect(wsRow).toBeVisible({ timeout: 45_000 });
    await expect(wsRow).toContainText("运行中", { timeout: 40_000 });

    // 获取工作区 ID 与对应容器名称
    const wsListRes = await api.listWorkspaces(ownerTokens.token, projId);
    const targetWs = wsListRes.data.find((w: any) => w.name === wsName);
    expect(targetWs).toBeTruthy();
    const shortId = targetWs!.id.slice(0, 8);
    const containerName = `ha-${shortId}`;

    // 通过宿主机探测验证真实物理容器状态并轮询等待 DHCP 分配内网 IP
    let containerInfo = await getIncusContainerInfo(shortId);
    for (let i = 0; i < 15 && (!containerInfo || !containerInfo.ip); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      containerInfo = await getIncusContainerInfo(shortId);
    }
    expect(containerInfo).not.toBeNull();
    expect(containerInfo!.state).toBe("RUNNING");
    expect(containerInfo!.ip).toMatch(/^10\.99\.0\.\d+$/);

    // ==========================================
    // 阶段七：真机 SSH 交互与连接配置
    // ==========================================
    const containerIp = containerInfo!.ip;
    const sshProbeCmd = `ssh -i ${keyPair.privateKeyPath} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@${containerIp} "echo REAL_JOURNEY_UP && hostname"`;
    
    // 容器内 sshd 服务初始化与网络就绪通常需数秒，执行轮询等待
    let probeOut = "";
    let lastProbeErr = "";
    for (let i = 0; i < 20; i++) {
      try {
        const res = await runCmd(sshProbeCmd);
        probeOut = res.stdout;
        if (probeOut.includes("REAL_JOURNEY_UP")) break;
      } catch (e: any) {
        lastProbeErr = e?.message || String(e);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!probeOut) {
      console.error(`[SSH Probe Failed] container: ${containerName}, ip: ${containerIp}, error: ${lastProbeErr}`);
    }
    expect(probeOut).toContain("REAL_JOURNEY_UP");
    expect(probeOut).toContain(containerName);

    // 在容器内部执行文件写入验证
    const verifyFileCmd = `ssh -i ${keyPair.privateKeyPath} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@${containerIp} "echo 'ha-cluster-e2e-flow-verified' > /root/e2e.status && cat /root/e2e.status"`;
    const { stdout: fileOut } = await runCmd(verifyFileCmd);
    expect(fileOut).toContain("ha-cluster-e2e-flow-verified");

    // 测试 UI 触发下载 SSH 客户端配置文件
    const [download] = await Promise.all([
      ownerPage.waitForEvent("download"),
      wsRow.locator("[data-testid=ws-ssh-download]").click(),
    ]);
    expect(download.suggestedFilename()).toBe(`ha-${shortId}.config`);

    // ==========================================
    // 阶段八：工作区启停与彻底销毁
    // ==========================================
    // 停止工作区
    await wsRow.locator("[data-testid=ws-stop]").click();
    await expect(wsRow).toContainText("已停止", { timeout: 30_000 });
    const stoppedInfo = await getIncusContainerInfo(shortId);
    expect(stoppedInfo!.state).toBe("STOPPED");

    // 重启工作区
    await wsRow.locator("[data-testid=ws-start]").click();
    await expect(wsRow).toContainText("运行中", { timeout: 30_000 });
    const restartedInfo = await getIncusContainerInfo(shortId);
    expect(restartedInfo!.state).toBe("RUNNING");

    // 销毁工作区
    ownerPage.once("dialog", (dialog) => dialog.accept());
    await wsRow.locator("[data-testid=ws-destroy]").click();
    await expect(wsRow).not.toBeVisible({ timeout: 30_000 });

    // 验证物理容器已被 Incus 彻底销毁
    const deletedInfo = await getIncusContainerInfo(shortId);
    expect(deletedInfo).toBeNull();

    // ==========================================
    // 阶段九：资源释放与审计日志合规对账
    // ==========================================
    // 验证项目已用配额恢复为 0
    await ownerPage.goto(`/projects/${projId}`);
    const finalUsage = ownerPage.locator("[data-testid=project-usage]");
    await expect(finalUsage).toBeVisible({ timeout: 15_000 });
    await expect(finalUsage).toContainText("CPU0");

    // 管理员查验审计日志
    await adminPage.goto("/audit-logs");
    await expect(adminPage.locator("table")).toBeVisible({ timeout: 15_000 });
    const auditText = await adminPage.locator("table tbody").textContent();
    expect(auditText).toBeTruthy();

    // 触发系统对账核验
    const adminTokens = await api.login("admin", process.env.HA_ADMIN_PASSWORD ?? "123456qq");
    const adminReconcile = await api.reconcile(adminTokens.token);
    expect(adminReconcile).toHaveProperty("released");

    // 清理测试上下文
    await ownerContext.close();
  });
});
