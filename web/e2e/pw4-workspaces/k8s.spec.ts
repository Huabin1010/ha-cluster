import { test, expect } from "../fixtures/auth";
import { api } from "../helpers/api";
import { seedProject, seedWorkspace } from "../fixtures/seed";
import { openCreateDialog, chooseSelect } from "../helpers/dialog";

const DEMO_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: e2e-web
spec:
  replicas: 1
`;

test.describe("PW-4 Kubernetes 工作区", () => {
  test.setTimeout(90_000);

  test("PW4-k8s @pw4 @smoke 开通 apply 资源与 kubeconfig", async ({ pageAs }) => {
    await api.heartbeat({
      name: `e2e-k3s-${Date.now()}`,
      arch: "amd64",
      role: "worker",
      ready: true,
      fabric_ip: "10.88.0.220",
      allocatable_cpu_milli: 8000,
      allocatable_mem_bytes: 8 * 1024 * 1024 * 1024,
      allocatable_disk_bytes: 200 * 1024 * 1024 * 1024,
      tags: ["k3s"],
    });

    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-k8s");

    await page.goto(`/workspaces?project_id=${p.id}`);
    await openCreateDialog(page, "ws-create");
    await chooseSelect(page, "ws-plan-select", "nano");
    await chooseSelect(page, "ws-arch-select", "amd64");
    await chooseSelect(page, "ws-create-runtime", "k8s");
    await page.getByTestId("ws-submit").click();

    const row = page.locator('[data-testid="ws-row"][data-status="running"]');
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Kubernetes");

    await row.getByTestId("ws-manage").click();
    await expect(page).toHaveURL(/\/workspaces\/.+\/k8s/);
    await expect(page.getByTestId("ws-k8s-yaml")).toBeVisible();
    await page.getByTestId("ws-k8s-yaml").fill(DEMO_YAML);
    await page.getByTestId("ws-k8s-apply").click();
    await expect(page.getByTestId("ws-k8s-resources")).toContainText("e2e-web");
    await expect(page.getByTestId("ws-k8s-kubeconfig")).toBeVisible();
  });

  test("PW4-k8s-api @pw4 详情页 apply（API 开通）", async ({ pageAs }) => {
    await api.heartbeat({
      name: `e2e-k3s-api-${Date.now()}`,
      arch: "amd64",
      role: "worker",
      ready: true,
      fabric_ip: "10.88.0.221",
      allocatable_cpu_milli: 8000,
      allocatable_mem_bytes: 8 * 1024 * 1024 * 1024,
      allocatable_disk_bytes: 200 * 1024 * 1024 * 1024,
      tags: ["k3s"],
    });

    const { page, tokens } = await pageAs("owner");
    const p = await seedProject(tokens.token, "ws-k8s2");
    const ws = await seedWorkspace(tokens.token, p.id, { name: "k8s-ui", plan: "nano", runtime: "k8s" });

    await page.goto(`/workspaces/${ws.id}/k8s`);
    await expect(page.getByTestId("ws-k8s-yaml")).toBeVisible();
    await page.getByTestId("ws-k8s-yaml").fill(DEMO_YAML);
    await page.getByTestId("ws-k8s-apply").click();
    await expect(page.getByTestId("ws-k8s-resources")).toContainText("e2e-web");
    await expect(page.getByTestId("ws-k8s-kubeconfig")).toBeEnabled();
  });
});
