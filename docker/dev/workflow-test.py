#!/usr/bin/env python3
"""E2E：用户创建项目 → 申请机器 → 审批 → SSH 连接信息。"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("HA_API_BASE", "http://127.0.0.1:8080").rstrip("/")
ADMIN_PASS = os.environ.get("HA_ADMIN_PASS", "123456qq")
UA = {"User-Agent": "ha-workflow-test/1.0"}
PUBKEY = os.environ.get(
    "HA_TEST_SSH_PUBKEY",
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDeti0v2hsgCzBW9NyUPYYis8PLq/R8kWZtyUIs8Tm28muECQjH6eRSr6CFPvN/YKyQzgoiylyxoudeIpzj/Aob0JlNJJtppgFw5336Pg/c9aZqmwVEaUKpvHo6txMpb80nBJPnellLFkWrcaoK9zEAp877QbuwZuTgNhOPPDF/9qOojS6ewnfe2Jfnpwn2bOHLG644fARjTvVsYWhww6B41BNt+ZWlkvYZVld3jPDp9Q7enxt6u4sRf8CWvJgmra5TVkjOKWhl4JcZk2GrfhGgJRv5s3H2UiRro5phwdUyYJNBZ5/rC7AaCZuzqgezTrXGnryvZoi/r9Dcxu+sY22V6yuiHuZwBqWseRAVEOtRPD7aOk+FxiYBITfGc5+CYwDLfS65z4t7Bo19nZuI6rPs8KPX7nDvLcOTLafIM5Rat4QKBLTXw+skfe4QcEPgfV8UsiON/DwNnTRT3S+bouFSLATBr/lek6XkrOTpD7A2Q82RE+OCV16FoeI2rd+qvOa7xfTiJ2Ukwj064WdUc5XuajNYPVblmKT6rG1+44/xs2ru3n28NSr31DNp/Rj6LJE/mFyb+9FyoY+vbdXk7ZSH2nbYcJ4Ty4iyadGxPeE7gOEnN9MBjEUOE8CR/U/jEBcKBIRP64aTlSsG25mwkFEtceJGDLVpUURUdCuawgWnhQ== dev-test-key",
)

passed = failed = 0
ts = int(time.time())


def api(method, path, body=None, token="", extra_headers=None):
    hdrs = {"Content-Type": "application/json", **UA}
    if extra_headers:
        hdrs.update(extra_headers)
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name}  {detail}")


def api_text(method, path, token="", extra_headers=None):
    hdrs = {**UA}
    if extra_headers:
        hdrs.update(extra_headers)
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def register_and_login(user, email, password="password1"):
    code, _ = api("POST", "/auth/register", {"username": user, "email": email, "password": password})
    if code not in (201, 409):
        raise RuntimeError(f"register {user}: {code}")
    code, login = api("POST", "/auth/login", {"username": user, "password": password})
    if code != 200:
        raise RuntimeError(f"login {user}: {code} {login}")
    return login["token"], login.get("user", {})


def step(title):
    print(f"\n── {title} ──")


def main():
    print(f"=== 用户申请机器全流程测试 @ {BASE} ===")
    owner_user = f"owner_{ts}"
    dev_user = f"dev_{ts}"
    slug = f"proj-{ts}"

    step("1. 注册用户")
    owner_tok, _ = register_and_login(owner_user, f"{owner_user}@test.local")
    dev_tok, _ = register_and_login(dev_user, f"{dev_user}@test.local")
    ok("owner 注册登录", bool(owner_tok))
    ok("developer 注册登录", bool(dev_tok))

    step("2. Owner 创建项目")
    code, proj = api("POST", "/projects", {"name": "我的项目", "slug": slug}, token=owner_tok)
    ok("创建项目 201", code == 201, str(proj))
    pid = proj.get("id", "")

    step("3. Owner 邀请 Developer 加入项目")
    code, mem = api(
        "POST",
        f"/projects/{pid}/members",
        {"username": dev_user, "role": "developer", "ssh_access": "granted"},
        token=owner_tok,
    )
    ok("添加 developer 成员（含 SSH）", code == 201, str(mem))

    step("4. Developer 申请机器")
    code, ws = api(
        "POST",
        f"/projects/{pid}/workspaces",
        {"name": "my-server", "plan": "nano", "arch": "amd64"},
        token=dev_tok,
    )
    ok("申请 workspace 201", code == 201, str(ws))
    ws_id = ws.get("id", "")
    status = ws.get("status", "")
    ok("状态为 requested（待审批）", status == "requested", f"got {status}")

    step("5. 审批前 Developer 不能获取 SSH 连接")
    code, conn = api("GET", f"/workspaces/{ws_id}/connection", token=dev_tok)
    ok("connection 审批前拒绝", code != 200, f"code={code} {conn}")
    code, target = api("GET", f"/workspaces/{ws_id}/ssh-target", token=dev_tok)
    ok("ssh-target 审批前拒绝", code != 200, f"code={code} {target}")

    step("6. Developer 不能自己审批")
    code, self = api("POST", f"/workspaces/{ws_id}/approve", token=dev_tok)
    ok("developer 自批 403", code == 403, str(self))

    step("7. Owner 审批")
    code, approved = api("POST", f"/workspaces/{ws_id}/approve", token=owner_tok)
    ok("owner 审批 200", code == 200, str(approved)[:300])
    final_status = approved.get("status", "")
    ok(
        "审批后状态 running（或 provisioning）",
        final_status in ("running", "provisioning"),
        f"got {final_status}",
    )
    ok("已分配到节点", bool(approved.get("node_id")), str(approved.get("node_id")))

    if final_status == "failed":
        print("\n  WARN: provision failed, skip SSH steps")
    else:
        step("8. Developer 添加 SSH 公钥")
        code, key = api("POST", "/me/ssh-keys", {"name": "laptop", "public_key": PUBKEY}, token=dev_tok)
        ok("添加 SSH 公钥", code in (200, 201, 409), str(key))

        step("9. Developer 获取 SSH 连接信息")
        code, conn = api("GET", f"/workspaces/{ws_id}/connection", token=dev_tok)
        ok("connection 200", code == 200, str(conn))
        ok("含跳板地址", "bastion" in json.dumps(conn), str(conn))
        code, target = api("GET", f"/workspaces/{ws_id}/ssh-target", token=dev_tok)
        ok("ssh-target 200", code == 200, str(target))
        ok("ssh-target 有 host/port", bool(target.get("host")) and target.get("port"), str(target))
        code, cfg = api_text("GET", f"/workspaces/{ws_id}/ssh-config", token=dev_tok)
        ok("ssh-config 200", code == 200, cfg[:200])
        ok("ssh-config 含 workspace_id", ws_id in cfg, cfg[:200])

        step("10. 审计日志")
        code, admin_login = api("POST", "/auth/login", {"username": "admin", "password": ADMIN_PASS})
        admin_tok = admin_login.get("token", "") if code == 200 else ""
        code, audit = api("GET", "/audit-logs", token=admin_tok)
        actions = []
        if code == 200:
            items = audit.get("data", audit)
            if isinstance(items, list):
                actions = [a.get("action") for a in items if a.get("resource_id") == ws_id]
        ok("有 workspace.request 审计", "workspace.request" in actions, str(actions))
        ok("有 workspace.approve 审计", "workspace.approve" in actions, str(actions))

    print(f"\n=== 结果: {passed} 通过, {failed} 失败 ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
