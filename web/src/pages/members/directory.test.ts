import { describe, expect, it } from "vitest";
import { memberCandidateLabel } from "./directory";

describe("memberCandidateLabel", () => {
  it("uses username when display name is empty or the same", () => {
    expect(memberCandidateLabel({ id: "1", username: "qa_dev" })).toBe("qa_dev");
    expect(memberCandidateLabel({ id: "1", username: "qa_dev", display_name: "qa_dev" })).toBe("qa_dev");
    expect(memberCandidateLabel({ id: "1", username: "qa_dev", display_name: "  " })).toBe("qa_dev");
  });

  it("shows display name with username for disambiguation", () => {
    expect(memberCandidateLabel({ id: "1", username: "zhang", display_name: "张三" })).toBe("张三（zhang）");
  });
});
