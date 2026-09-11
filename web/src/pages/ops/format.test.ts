import { describe, expect, it } from "vitest";
import {
  actionLabel,
  auditChangeSummary,
  auditResourceTitle,
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
    expect(actionLabel("membership.update")).toBe("更新成员权限");
    expect(actionLabel("ssh_access.grant")).toBe("授予 SSH 权限");
    expect(actionLabel("ssh.allow")).toBe("SSH 放行");
    expect(actionLabel("ssh.deny")).toBe("SSH 拒绝");
    expect(actionLabel("ssh.session.open")).toBe("打开网页终端");
    expect(actionLabel("ssh.session.close")).toBe("关闭网页终端");
    expect(actionLabel("workspace.start")).toBe("启动服务器");
    expect(actionLabel("workspace.stop")).toBe("停止服务器");
    expect(actionLabel("node.join_token_issued")).toBe("签发节点加入令牌");
  });

  it("falls back to raw action", () => {
    expect(actionLabel("unknown.op")).toBe("unknown.op");
  });

  it("maps resource types and shortens ids", () => {
    expect(resourceTypeLabel("user")).toBe("用户");
    expect(resourceTypeLabel("project")).toBe("项目");
    expect(resourceTypeLabel("workspace")).toBe("服务器");
    expect(resourceTypeLabel("membership")).toBe("成员");
    expect(resourceLabel("user", "b1556622-aaaa-bbbb-cccc-dddddddddddd")).toBe("用户:b1556622…");
    expect(resourceLabel("project", "abc")).toBe("项目:abc");
    expect(resourceLabel()).toBe("—");
  });
});

describe("audit change summary", () => {
  it("shows membership role and SSH from → to", () => {
    expect(
      auditChangeSummary("membership.update", {
        from_role: "viewer",
        to_role: "developer",
        from_ssh_access: "none",
        to_ssh_access: "granted",
        from_ssh_mode: "",
        to_ssh_mode: "read_write",
      }),
    ).toBe("角色 观察者 → 开发者 · SSH 未开通 → 已授权 · 读写");
    expect(auditResourceTitle("membership", "af2b9211-xxxx", { target_username: "qa_dev" })).toBe("成员 qa_dev");
  });

  it("shows resize spec from → to", () => {
    const Mi = 1024 * 1024;
    const Gi = 1024 * Mi;
    expect(
      auditChangeSummary("workspace.resize.request", {
        kind: "upgrade",
        from_cpu_milli: 500,
        from_mem_bytes: 256 * Mi,
        from_disk_bytes: 5 * Gi,
        to_cpu_milli: 2000,
        to_mem_bytes: 2 * Gi,
        to_disk_bytes: 5 * Gi,
      }),
    ).toBe("升配 0.5 核 / 256 Mi / 5.0 Gi → 2 核 / 2.0 Gi / 5.0 Gi");
    expect(auditResourceTitle("workspace", "abc-id", { workspace_name: "demo-box" })).toBe("服务器 demo-box");
  });

  it("falls back when meta is empty", () => {
    expect(auditChangeSummary("user.login")).toBe("");
    expect(auditResourceTitle("user", "00000000-1111-2222-3333-444444444444")).toBe("用户 00000000…");
  });
});
