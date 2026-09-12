import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { AgentPackButton } from "./agent-pack-button";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers", () => ({
  api: vi.fn(),
  friendlyError: (e: unknown) => (e instanceof Error ? e.message : "err"),
}));
vi.mock("@/ui/format", () => ({ copyText: vi.fn(async () => true) }));

import { api } from "@/providers";
import { copyText } from "@/ui/format";
import { toast } from "sonner";

function wrap(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("AgentPackButton", () => {
  beforeEach(() => {
    vi.mocked(api).mockResolvedValue({
      url: "https://cl.qzsyzn.com/api/agent-pack/haagt_test",
      prompt: "curl -fsSL https://cl.qzsyzn.com/api/agent-pack/haagt_test",
      prefix: "haagt_test",
    });
    vi.mocked(copyText).mockResolvedValue(true);
  });

  it("copies pack prompt on click", async () => {
    wrap(<AgentPackButton rail={false} />);
    fireEvent.click(screen.getByTestId("nav-agent-pack"));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/me/agent-pack"));
    expect(copyText).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});
