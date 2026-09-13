import { describe, expect, it } from "vitest";
import {
  actionLabel,
  auditActorLabel,
  auditChangeSummary,
  auditResourceHref,
  auditResourceName,
  auditResourceTitle,
  canOpenAuditResource,
  findLastAction,
  findLastLogin,
  fmtBytes,
  fmtCPU,
  fmtTime,
  recentLogsForResource,
  resourceLabel,
  resourceTypeLabel,
  uniqueResourceNames,
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
    expect(actionLabel("ssh.exec")).toBe("SSH 执行命令");
    expect(actionLabel("ssh.exec.deny")).toBe("SSH 执行失败");
    expect(actionLabel("k8s.apply")).toBe("应用 K8s 清单");
    expect(actionLabel("k8s.apply.deny")).toBe("K8s 清单被拒绝");
    expect(actionLabel("k8s.delete")).toBe("删除 K8s 资源");
    expect(actionLabel("kubeconfig.download")).toBe("下载 kubeconfig");
    expect(actionLabel("agent_token.issue")).toBe("签发 Agent 令牌");
    expect(actionLabel("tls.issue")).toBe("签发 TLS 证书");
    expect(actionLabel("ingress_domain_zone.create")).toBe("添加域名分区");
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
    expect(resourceTypeLabel("ingress_domain_zone")).toBe("域名分区");
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

  it("prefers project / workspace / display names over ids", () => {
    expect(auditResourceTitle("project", "7d9a6cd4-xxxx", { project_name: "办公室故事" })).toBe("项目 办公室故事");
    expect(auditResourceName("project", "7d9a6cd4-xxxx", {}, "办公室故事")).toBe("办公室故事");
    expect(auditResourceTitle("workspace", "9031b376-xxxx", { workspace_name: "开发机" })).toBe("服务器 开发机");
    expect(auditResourceTitle("user", "00000000-xxxx", { display_name: "黄华斌", username: "huanghuabin" })).toBe("用户 黄华斌");
  });

  it("shows actor display name and falls back to username", () => {
    expect(auditActorLabel("黄华斌", "huanghuabin", "uid")).toBe("黄华斌");
    expect(auditActorLabel("  ", "admin", "uid")).toBe("admin");
    expect(auditActorLabel("", "", "00000000-1111-2222-3333-444444444444")).toBe("00000000…");
  });

  it("shows ssh.exec command and deny error", () => {
    expect(auditChangeSummary("ssh.exec", { command: "uname -a" })).toBe("uname -a");
    expect(auditChangeSummary("ssh.exec.deny", { command: "rm -rf /", error: "permission denied" })).toBe(
      "rm -rf / · 原因：permission denied",
    );
  });
});

describe("audit resource links", () => {
  it("builds hrefs for known resource types", () => {
    expect(auditResourceHref("workspace", "ws-1")).toBe("/workspaces/ws-1");
    expect(auditResourceHref("project", "p-1")).toBe("/projects/p-1");
    expect(auditResourceHref("membership", "u-1", { project_id: "p-9" })).toBe("/projects/p-9/members");
    expect(auditResourceHref("user", "u-1")).toBe("/users?q=u-1");
    expect(auditResourceHref("ingress", "r-1", { workspace: "ws-2" })).toBe("/workspaces/ws-2/ingress");
    expect(auditResourceHref("unknown", "x")).toBe("");
  });

  it("lets platform admin open any mapped resource", () => {
    expect(
      canOpenAuditResource("workspace", "ws-1", undefined, { platformRole: "platform_admin" }),
    ).toBe(true);
    expect(canOpenAuditResource("user", "u-1", undefined, { platformRole: "platform_admin" })).toBe(true);
  });

  it("lets members open own project or workspace only", () => {
    expect(
      canOpenAuditResource("workspace", "ws-1", undefined, {
        platformRole: "platform_ops",
        visibleWorkspaceIds: ["ws-1"],
      }),
    ).toBe(true);
    expect(
      canOpenAuditResource("workspace", "ws-2", undefined, {
        platformRole: "platform_ops",
        visibleWorkspaceIds: ["ws-1"],
      }),
    ).toBe(false);
    expect(
      canOpenAuditResource("user", "me", undefined, { userId: "me", platformRole: "platform_user" }),
    ).toBe(false);
    expect(
      canOpenAuditResource("user", "other", undefined, { userId: "me", platformRole: "platform_user" }),
    ).toBe(false);
  });
});

describe("audit hover summaries", () => {
  const logs = [
    { actor_user_id: "u1", action: "ssh.exec", resource_type: "workspace", resource_id: "ws-1", resource_name: "box-a", created_at: "2026-09-13T01:00:00Z" },
    { actor_user_id: "u1", action: "user.login", resource_type: "user", resource_id: "u1", created_at: "2026-09-13T00:50:00Z" },
    { actor_user_id: "u1", action: "ssh.exec.deny", resource_type: "workspace", resource_id: "ws-1", resource_name: "box-a", created_at: "2026-09-13T00:40:00Z" },
    { actor_user_id: "u2", action: "user.login", resource_type: "user", resource_id: "u2", created_at: "2026-09-12T10:00:00Z" },
  ];

  it("finds last login and last action for a user", () => {
    expect(findLastLogin(logs, "u1")).toBe("2026-09-13T00:50:00Z");
    expect(findLastAction(logs, "u1")?.action).toBe("ssh.exec");
    expect(findLastLogin(logs, "missing")).toBe("");
  });

  it("lists recent resource events and unique names", () => {
    expect(recentLogsForResource(logs, "ws-1").map((l) => l.action)).toEqual(["ssh.exec", "ssh.exec.deny"]);
    expect(uniqueResourceNames(logs, "u1", "workspace")).toEqual(["box-a"]);
  });
});
