import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { K8sPanel } from "./K8sPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emptyK8sStatus } from "./k8s-status";
import type { Workspace } from "./types";

vi.mock("@/providers", () => ({
  api: vi.fn(),
  friendlyError: (e: unknown) => (e instanceof Error ? e.message : "err"),
}));

import { api } from "@/providers";

const ws: Workspace = {
  id: "ws-1",
  name: "goals-k8s",
  plan: "2c2g",
  arch: "amd64",
  status: "running",
  project_id: "p1",
  runtime: "k8s",
  runtime_ref: "ns-1",
};

function wrap(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("K8sPanel loading", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it("shows loading instead of empty tables while status is in flight", async () => {
    let resolveStatus!: (value: unknown) => void;
    vi.mocked(api).mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );

    wrap(<K8sPanel ws={ws} myRole="owner" />);

    expect(screen.getByTestId("ws-k8s-loading").textContent).toContain("正在获取集群状态");
    expect(screen.getByText("正在获取 Pod 状态…")).toBeTruthy();
    expect(screen.getByText("正在获取已应用资源…")).toBeTruthy();
    expect(screen.queryByText(/还没有 Pod/)).toBeNull();
    expect(screen.queryByText("还没有已应用的资源。")).toBeNull();
    expect(screen.queryByText(/Deployment 0\/0/)).toBeNull();

    resolveStatus(emptyK8sStatus("ns-1"));
    await waitFor(() => {
      expect(screen.queryByTestId("ws-k8s-loading")).toBeNull();
    });
    expect(screen.getByText(/还没有 Pod/)).toBeTruthy();
    expect(screen.getByText("还没有已应用的资源。")).toBeTruthy();
    expect(screen.getByText(/Deployment 0\/0/)).toBeTruthy();
  });
});
