import { describe, expect, it } from "vitest";
import {
  actionLabel,
  fmtBytes,
  fmtCPU,
  fmtTime,
  resourceLabel,
  resourceTypeLabel,
} from "./format";

describe("ops/format", () => {
  it("fmtBytes scales Mi/Gi", () => {
    expect(fmtBytes(0)).toBe("0");
    expect(fmtBytes(1024 * 1024)).toBe("1 Mi");
    expect(fmtBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 Gi");
  });

  it("fmtCPU shows cores", () => {
    expect(fmtCPU(0)).toBe("0");
    expect(fmtCPU(1000)).toBe("1 核");
    expect(fmtCPU(1500)).toBe("1.5 核");
  });

  it("fmtTime handles empty", () => {
    expect(fmtTime("")).toBe("—");
  });
});

describe("audit labels", () => {
  it("maps known actions to Chinese", () => {
    expect(actionLabel("user.register")).toBe("用户注册");
    expect(actionLabel("user.login")).toBe("用户登录");
    expect(actionLabel("project.create")).toBe("创建项目");
    expect(actionLabel("project.update")).toBe("更新项目");
    expect(actionLabel("project.delete")).toBe("删除项目");
    expect(actionLabel("workspace.create")).toBe("开通服务器");
    expect(actionLabel("workspace.request")).toBe("申请服务器");
    expect(actionLabel("workspace.approve")).toBe("批准服务器");
    expect(actionLabel("workspace.resize.request")).toBe("申请扩容");
    expect(actionLabel("workspace.resize.approve")).toBe("批准扩容");
    expect(actionLabel("invite.create")).toBe("创建邀请");
    expect(actionLabel("ssh.allow")).toBe("SSH 放行");
    expect(actionLabel("ssh.deny")).toBe("SSH 拒绝");
  });

  it("falls back to raw action", () => {
    expect(actionLabel("unknown.op")).toBe("unknown.op");
  });

  it("maps resource types and shortens ids", () => {
    expect(resourceTypeLabel("user")).toBe("用户");
    expect(resourceTypeLabel("project")).toBe("项目");
    expect(resourceTypeLabel("workspace")).toBe("服务器");
    expect(resourceLabel("user", "b1556622-aaaa-bbbb-cccc-dddddddddddd")).toBe("用户:b1556622…");
    expect(resourceLabel("project", "abc")).toBe("项目:abc");
    expect(resourceLabel()).toBe("—");
  });
});
