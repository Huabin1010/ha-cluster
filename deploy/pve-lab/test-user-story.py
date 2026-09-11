#!/usr/bin/env python3
"""全面验收：邀请入项、接受、工作区开通、SSH 权益、Owner 转让。

  python deploy/pve-lab/test-user-story.py
  HA_API_BASE=http://192.168.1.60:8080 python deploy/pve-lab/test-user-story.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

BASE = os.environ.get("HA_API_BASE", "http://192.168.1.60:8080").rstrip("/")
ADMIN_USER = os.environ.get("HA_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("HA_ADMIN_PASS", "123456qq")
TS = str(int(time.time()))[-8:]
PASS = "StoryPass123!"


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Client:
    token: str = ""
    user: dict = field(default_factory=dict)

    def req(self, method: str, path: str, body=None, token: str | None = None):
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        tok = self.token if token is None else token
        if tok:
            headers["Authorization"] = "Bearer " + tok
        req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                payload = json.loads(raw) if raw else None
                return r.status, payload
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                payload = json.loads(raw) if raw else {"error": e.reason}
            except json.JSONDecodeError:
                payload = {"error": raw.decode("utf-8", "replace")}
            return e.code, payload


def expect(results: list[Result], name: str, cond: bool, detail: str = "") -> bool:
    results.append(Result(name, cond, detail if not cond else (detail or "ok")))
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail and not cond else ""))
    return cond


def wait_ws(c: Client, ws_id: str, want=("running",), timeout=180) -> dict:
    t0 = time.time()
    last = {}
    while time.time() - t0 < timeout:
        code, last = c.req("GET", f"/workspaces/{ws_id}")
        if code == 200 and (last or {}).get("status") in want:
            return last
        if code == 200 and (last or {}).get("status") in ("failed", "rejected"):
            return last
        time.sleep(3)
    return last or {}


def destroy_ws(owner: Client, admin: Client, ws_id: str) -> None:
    code, body = owner.req("POST", f"/workspaces/{ws_id}/destroy-request", {})
    status = (body or {}).get("status")
    if status == "destroy_requested":
        owner.req("POST", f"/workspaces/{ws_id}/destroy-request/approve", {})
        status = "destroy_pending_platform"
    if status != "destroyed":
        admin.req("POST", f"/admin/dangerous-approvals/{ws_id}/approve", {})


def member_by_user(members: list, user_id: str) -> dict | None:
    for m in members:
        if m.get("user_id") == user_id:
            return m
    return None


def main() -> int:
    results: list[Result] = []
    api = Client()
    print(f"==> API {BASE}  story={TS}")

    # ── 0. 平台管理员 ──
    code, admin_login = api.req("POST", "/auth/login", {"username": ADMIN_USER, "password": ADMIN_PASS})
    if not expect(results, "管理员登录", code == 200 and admin_login.get("token"), str(admin_login)):
        return 1
    admin = Client(admin_login["token"], admin_login.get("user") or {})

    code, nodes = admin.req("GET", "/nodes")
    ready = [n["name"] for n in (nodes or {}).get("data", []) if n.get("ready")]
    expect(results, "集群有 Ready 节点", len(ready) >= 1, f"ready={ready}")

    # ── 1. 四名用户注册（模拟邀请前未入项 / 局外人）──
    users = {}
    for role, email_local in (("alice", "alice"), ("bob", "bob"), ("carol", "carol"), ("dave", "dave")):
        uname = f"st_{role}_{TS}"
        email = f"{email_local}.{TS}@ha-lab.test"
        code, _ = api.req("POST", "/auth/register", {"username": uname, "email": email, "password": PASS})
        expect(results, f"注册 {role}", code in (200, 201), f"status={code}")
        code, login = api.req("POST", "/auth/login", {"username": uname, "password": PASS})
        expect(results, f"登录 {role}", code == 200, f"status={code} {login}")
        users[role] = Client(login.get("token", ""), {**(login.get("user") or {}), "email": email, "username": uname})

    alice, bob, carol, dave = users["alice"], users["bob"], users["carol"], users["dave"]

    # ── 2. Alice 创建项目（系统）──
    slug = f"story-{TS}"
    code, proj = alice.req("POST", "/projects", {"name": f"故事项目 {TS}", "slug": slug})
    expect(results, "Alice 创建项目", code == 201 and proj.get("id"), str(proj))
    pid = proj["id"]

    code, got = alice.req("GET", f"/projects/{pid}")
    expect(results, "Alice 可见自己的项目", code == 200 and got.get("my_role") == "owner", f"{code} {got}")

    code, listed = dave.req("GET", "/projects")
    names = [p.get("slug") for p in (listed or {}).get("data", [])]
    expect(results, "局外人 Dave 列表不含该项目", slug not in names, f"slugs={names}")

    code, hidden = dave.req("GET", f"/projects/{pid}")
    expect(results, "局外人直链项目被拒绝", code in (403, 404), f"status={code} {hidden}")

    # ── 3. 邀请 Bob（developer）──
    code, inv_bob = alice.req("POST", f"/projects/{pid}/invitations", {"email": bob.user["email"], "role": "developer"})
    expect(results, "Alice 邀请 Bob 为 developer", code == 201 and inv_bob.get("token"), str(inv_bob))
    bob_token = inv_bob.get("token", "")

    code, inv_denied = bob.req("POST", f"/projects/{pid}/invitations", {"email": carol.user["email"], "role": "viewer"})
    expect(results, "未入项的人发邀请被拒绝（不泄露项目）", code in (403, 404), f"status={code}")

    # 邮箱不匹配不能接受
    code, mismatch = carol.req("POST", "/invitations/accept", {"token": bob_token})
    expect(results, "Carol 不能接受发给 Bob 的邀请", code in (400, 403), f"status={code} {mismatch}")

    # 未登录
    code, anon = api.req("POST", "/invitations/accept", {"token": bob_token})
    expect(results, "未登录不能接受邀请", code in (401, 403), f"status={code}")

    # Bob 接受
    code, acc = bob.req("POST", "/invitations/accept", {"token": bob_token})
    expect(results, "Bob 接受邀请加入项目", code == 200 and acc.get("status") == "accepted", str(acc))

    code, again = bob.req("POST", "/invitations/accept", {"token": bob_token})
    expect(results, "重复接受邀请冲突", code == 409, f"status={code} {again}")

    code, bob_proj = bob.req("GET", f"/projects/{pid}")
    expect(results, "Bob 接受后能看见项目", code == 200 and bob_proj.get("my_role") == "developer", f"{code} {bob_proj}")

    code, inv_dev = bob.req("POST", f"/projects/{pid}/invitations", {"email": dave.user["email"], "role": "viewer"})
    expect(results, "developer 不能发邀请", code == 403, f"status={code} {inv_dev}")

    code, members = alice.req("GET", f"/projects/{pid}/members")
    mems = (members or {}).get("data", [])
    bob_mem = member_by_user(mems, bob.user["id"])
    expect(results, "成员表含 Bob 且默认无 SSH", bool(bob_mem) and bob_mem.get("ssh_access") in ("none", "", None), str(bob_mem))

    # ── 4. 邀请 Carol（viewer）──
    code, inv_carol = alice.req("POST", f"/projects/{pid}/invitations", {"email": carol.user["email"], "role": "viewer"})
    expect(results, "Alice 邀请 Carol 为 viewer", code == 201, str(inv_carol))
    code, acc_c = carol.req("POST", "/invitations/accept", {"token": inv_carol.get("token", "")})
    expect(results, "Carol 接受 viewer 邀请", code == 200, str(acc_c))
    code, carol_proj = carol.req("GET", f"/projects/{pid}")
    expect(results, "Carol 角色为 viewer", code == 200 and carol_proj.get("my_role") == "viewer", str(carol_proj))

    # ── 5. 工作区：viewer 不能建；developer 须审批；owner 可直开 ──
    code, ws_viewer = carol.req("POST", f"/projects/{pid}/workspaces", {"name": "ws-carol", "plan": "nano", "arch": "amd64"})
    expect(results, "viewer 不能创建工作区", code in (403, 400), f"status={code} {ws_viewer}")

    code, ws_req = bob.req("POST", f"/projects/{pid}/workspaces", {"name": f"ws-bob-{TS}", "plan": "nano", "arch": "amd64", "visibility": "shared"})
    expect(results, "developer 创建进入待审批", code == 201 and (ws_req or {}).get("status") == "requested", str(ws_req))
    ws_shared_id = (ws_req or {}).get("id", "")

    code, conn_before = bob.req("GET", f"/workspaces/{ws_shared_id}/connection")
    expect(results, "待审批工作区不可连接", code != 200, f"status={code}")

    code, _ = carol.req("POST", f"/workspaces/{ws_shared_id}/approve", {})
    expect(results, "viewer 不能批准工作区", code == 403, f"status={code}")

    code, approved = alice.req("POST", f"/workspaces/{ws_shared_id}/approve", {})
    expect(results, "owner 批准 Bob 的工作区", code == 200, str(approved)[:300])
    ws = wait_ws(alice, ws_shared_id, ("running", "failed"))
    expect(results, "共享工作区进入 running", ws.get("status") == "running", f"status={ws.get('status')} node={ws.get('node_name')}")

    # ── 6. SSH 权益：申请 → 审批 → 可拿连接命令 ──
    code, conn_no_ssh = bob.req("GET", f"/workspaces/{ws_shared_id}/connection")
    expect(results, "developer 未授权 SSH 时不可拿连接", code == 403, f"status={code} {conn_no_ssh}")

    code, ssh_req = bob.req("POST", f"/projects/{pid}/ssh-access-request", {})
    expect(results, "Bob 申请 SSH", code == 200 and (ssh_req or {}).get("ssh_access") == "pending", str(ssh_req))

    code, ssh_ok = alice.req("POST", f"/projects/{pid}/members/{bob.user['id']}/ssh-access/approve", {})
    expect(results, "Alice 批准 Bob 的 SSH", code == 200 and (ssh_ok or {}).get("ssh_access") == "granted", str(ssh_ok))

    code, conn = bob.req("GET", f"/workspaces/{ws_shared_id}/connection")
    expect(
        results,
        "SSH 批准后 Bob 可拿连接命令",
        code == 200 and "ssh" in str((conn or {}).get("command", "")).lower(),
        f"{code} {conn}",
    )

    code, conn_carol = carol.req("GET", f"/workspaces/{ws_shared_id}/connection")
    expect(results, "viewer 默认仍不可 SSH", code == 403, f"status={code}")

    # ── 7. 私有工作区：权益隔离 ──
    code, ws_priv = alice.req(
        "POST",
        f"/projects/{pid}/workspaces",
        {"name": f"ws-priv-{TS}", "plan": "nano", "arch": "amd64", "visibility": "private"},
    )
    expect(results, "owner 创建私有工作区（免审批）", code == 201, str(ws_priv)[:200])
    ws_priv_id = (ws_priv or {}).get("id", "")
    priv = wait_ws(alice, ws_priv_id, ("running", "failed"))
    expect(results, "私有工作区 running", priv.get("status") == "running", f"status={priv.get('status')}")

    code, bob_priv = bob.req("GET", f"/workspaces/{ws_priv_id}/connection")
    expect(results, "其他 developer 不能进私有工作区", code == 403, f"status={code}")

    code, alice_priv = alice.req("GET", f"/workspaces/{ws_priv_id}/connection")
    expect(results, "owner 可连接自己的私有工作区", code == 200, f"status={code}")

    # ── 8. Owner 权益转让 ──
    code, xfer_denied = bob.req("POST", f"/projects/{pid}/transfer-ownership", {"new_owner_user_id": bob.user["id"]})
    expect(results, "developer 不能自行夺走 Owner", code == 403, f"status={code}")

    code, xfer_dave = alice.req("POST", f"/projects/{pid}/transfer-ownership", {"new_owner_user_id": dave.user["id"]})
    expect(results, "不能转让给非成员 Dave", code in (400, 404), f"status={code} {xfer_dave}")

    code, xfer = alice.req("POST", f"/projects/{pid}/transfer-ownership", {"new_owner_user_id": bob.user["id"]})
    expect(results, "Alice 把 Owner 转让给 Bob", code == 200 and (xfer or {}).get("status") == "transferred", str(xfer))

    code, alice_after = alice.req("GET", f"/projects/{pid}")
    expect(results, "原 Owner 降为 developer", code == 200 and alice_after.get("my_role") == "developer", str(alice_after))

    code, bob_after = bob.req("GET", f"/projects/{pid}")
    expect(results, "Bob 升为 owner", code == 200 and bob_after.get("my_role") == "owner", str(bob_after))

    code, members2 = bob.req("GET", f"/projects/{pid}/members")
    alice_mem = member_by_user((members2 or {}).get("data", []), alice.user["id"])
    expect(
        results,
        "转让后原 Owner SSH 被收回",
        bool(alice_mem) and alice_mem.get("role") == "developer" and alice_mem.get("ssh_access") in ("none", "", None),
        str(alice_mem),
    )

    code, alice_conn = alice.req("GET", f"/workspaces/{ws_shared_id}/connection")
    expect(results, "转让后 Alice 暂不可 SSH 共享机", code == 403, f"status={code}")

    code, budget = alice.req("PATCH", f"/projects/{pid}", {"budget_cpu_milli": 8000})
    expect(results, "降级后的 Alice 不能改预算", code == 403, f"status={code}")

    code, budget_ok = bob.req("PATCH", f"/projects/{pid}", {"budget_cpu_milli": 8000, "budget_mem_bytes": 8 * 1024**3, "budget_disk_bytes": 80 * 1024**3})
    expect(results, "新 Owner Bob 能改预算", code == 200, f"status={code}")

    code, inv_admin = alice.req("POST", f"/projects/{pid}/invitations", {"email": dave.user["email"], "role": "admin"})
    expect(results, "developer 不能邀请 admin", code == 403, f"status={code}")

    # 新 Owner 把 SSH 再授给 Alice（权益二次转接）
    code, ssh2 = alice.req("POST", f"/projects/{pid}/ssh-access-request", {})
    expect(results, "Alice 再次申请 SSH", code == 200, str(ssh2))
    code, grant2 = bob.req("POST", f"/projects/{pid}/members/{alice.user['id']}/ssh-access/approve", {})
    expect(results, "新 Owner 把 SSH 授回 Alice", code == 200 and (grant2 or {}).get("ssh_access") == "granted", str(grant2))
    code, alice_conn2 = alice.req("GET", f"/workspaces/{ws_shared_id}/connection")
    expect(results, "授回后 Alice 可再连共享机", code == 200, f"status={code}")

    # 私有机仍归原创建者；新 owner/admin 按规则可进
    code, bob_priv2 = bob.req("GET", f"/workspaces/{ws_priv_id}/connection")
    expect(results, "新 Owner 可进项目内私有工作区", code == 200, f"status={code} {bob_priv2}")

    # ── 9. 清理工作区（项目初审 + 平台终审）──
    def wait_destroyed(c: Client, ws_id: str) -> tuple[int, dict]:
        t0 = time.time()
        last_code, last = 0, {}
        while time.time() - t0 < 120:
            last_code, last = c.req("GET", f"/workspaces/{ws_id}")
            if last_code == 404:
                return last_code, last or {}
            if last_code == 200 and (last or {}).get("status") == "destroyed":
                return last_code, last
            time.sleep(3)
        return last_code, last or {}

    if ws_shared_id:
        destroy_ws(bob, admin, ws_shared_id)
        code, gone = wait_destroyed(bob, ws_shared_id)
        expect(results, "共享工作区走完销毁审批", code == 404 or (gone or {}).get("status") == "destroyed", f"{code} {gone}")
    if ws_priv_id:
        destroy_ws(bob, admin, ws_priv_id)
        code, gonep = wait_destroyed(bob, ws_priv_id)
        expect(results, "私有工作区走完销毁审批", code == 404 or (gonep or {}).get("status") == "destroyed", f"{code} {gonep}")

    # ── 汇总 ──
    failed = [r for r in results if not r.ok]
    print()
    print(f"==> {len(results) - len(failed)}/{len(results)} passed, {len(failed)} failed")
    for r in failed:
        print(f"     FAIL {r.name}: {r.detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
