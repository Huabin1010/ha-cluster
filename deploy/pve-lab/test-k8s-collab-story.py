#!/usr/bin/env python3
"""完整 k8s 用户故事：邀请入项 → 开通 Kubernetes 机器 → apply → 真集群 Pod → kubeconfig → 销毁。

  python deploy/pve-lab/test-k8s-collab-story.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bootstrap import guest_exec, load_env  # noqa: E402

LAB = Path(__file__).resolve().parent
K3S_VMID = int(os.environ.get("HA_K3S_VMID", "116"))
TS = str(int(time.time()))[-8:]
PASS = "K8sStoryPass123!"
DEMO = """apiVersion: apps/v1
kind: Deployment
metadata:
  name: story-web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: story-web
  template:
    metadata:
      labels:
        app: story-web
    spec:
      containers:
      - name: web
        image: docker.io/rancher/mirrored-library-busybox:1.37.0
        command: ["sleep", "3600"]
        resources:
          requests:
            cpu: 10m
            memory: 16Mi
"""


class Client:
    def __init__(self, base: str, token: str = "", user: dict | None = None):
        self.base = base
        self.token = token
        self.user = user or {}

    def req(self, method: str, path: str, body=None):
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read()
                return r.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else {"error": e.reason}
            except json.JSONDecodeError:
                return e.code, {"error": raw.decode("utf-8", "replace")[:300]}


def guest_text(raw: str) -> str:
    try:
        j = json.loads(raw[raw.find("{") :])
        return (j.get("out-data") or "") + (j.get("err-data") or "")
    except json.JSONDecodeError:
        return raw


def expect(results: list, name: str, cond: bool, detail: str = "") -> bool:
    results.append((name, cond, detail))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail and not cond else ""))
    return cond


def wait_ws(c: Client, ws_id: str, timeout=180) -> dict:
    last: dict = {}
    t0 = time.time()
    while time.time() - t0 < timeout:
        code, last = c.req("GET", f"/workspaces/{ws_id}")
        if code == 200 and (last or {}).get("status") in ("running", "failed", "rejected"):
            return last or {}
        time.sleep(3)
    return last or {}


def main() -> int:
    env = load_env(LAB / "lab.env")
    base = env.get("HA_API_BASE", "http://192.168.1.60:8080").rstrip("/")
    results: list = []
    print(f"==> k8s collab story API {base}  story={TS}")

    anon = Client(base)
    code, login = anon.req(
        "POST",
        "/auth/login",
        {"username": env.get("HA_ADMIN_USER", "admin"), "password": env.get("HA_ADMIN_PASS", "")},
    )
    if not expect(results, "管理员登录", code == 200 and (login or {}).get("token"), str(login)):
        return 1
    admin = Client(base, login["token"], login.get("user") or {})

    code, ver = admin.req("GET", "/agent-pack/version")
    expect(results, "控制面含 Kubernetes API", code == 200 and int((ver or {}).get("version") or 0) >= 4, str(ver))

    code, nodes = admin.req("GET", "/nodes")
    tagged = [n for n in (nodes or {}).get("data", []) if n.get("ready") and "k3s" in (n.get("tags") or [])]
    expect(results, "有带 k3s 标签的 Ready 节点", len(tagged) >= 1, str([(n.get("name"), n.get("tags")) for n in (nodes or {}).get("data", [])]))

    users: dict[str, Client] = {}
    for role in ("alice", "bob", "outsider"):
        uname = f"k8s_{role}_{TS}"
        email = f"{role}.{TS}@ha-lab.test"
        code, _ = anon.req("POST", "/auth/register", {"username": uname, "email": email, "password": PASS})
        expect(results, f"注册 {role}", code in (200, 201), f"status={code}")
        code, lg = anon.req("POST", "/auth/login", {"username": uname, "password": PASS})
        expect(results, f"登录 {role}", code == 200, f"status={code}")
        users[role] = Client(base, (lg or {}).get("token", ""), {**((lg or {}).get("user") or {}), "email": email})

    alice, bob, outsider = users["alice"], users["bob"], users["outsider"]
    slug = f"k8scollab-{TS}"
    code, proj = alice.req("POST", "/projects", {"name": f"K8s 故事 {TS}", "slug": slug, "purpose": "K8s 协作故事"})
    expect(results, "Alice 创建项目", code == 201 and (proj or {}).get("id"), str(proj))
    pid = (proj or {}).get("id")

    code, listed = outsider.req("GET", "/projects")
    slugs = [p.get("slug") for p in (listed or {}).get("data", [])]
    expect(results, "局外人列表看不到项目", slug not in slugs, f"slugs={slugs}")

    code, inv = alice.req("POST", f"/projects/{pid}/invitations", {"email": bob.user["email"], "role": "developer"})
    expect(results, "Alice 邀请 Bob 为 developer", code == 201 and (inv or {}).get("token"), str(inv))
    code, acc = bob.req("POST", "/invitations/accept", {"token": (inv or {}).get("token")})
    expect(results, "Bob 接受邀请", code == 200, str(acc))

    code, req_ws = bob.req(
        "POST",
        f"/projects/{pid}/workspaces",
        {"name": "k8s-bob", "plan": "nano", "arch": "amd64", "runtime": "k8s"},
    )
    pending = (req_ws or {}).get("status") in ("pending", "pending_approval", "requested")
    expect(results, "developer 申请 k8s 机器进入待审", code in (200, 201) and pending, f"{code} {(req_ws or {}).get('status')}")
    bob_wid = (req_ws or {}).get("id")
    if bob_wid:
        alice.req("POST", f"/workspaces/{bob_wid}/reject", {})

    code, ws = alice.req(
        "POST",
        f"/projects/{pid}/workspaces",
        {"name": "k8s-alice", "plan": "nano", "arch": "amd64", "runtime": "k8s"},
    )
    expect(results, "owner 直开 Kubernetes 机器", code == 201 and (ws or {}).get("runtime") == "k8s", str(ws)[:300])
    wid = (ws or {}).get("id")
    ws = wait_ws(alice, wid)
    expect(results, "k8s 工作区 running", ws.get("status") == "running", f"status={ws.get('status')} node={ws.get('node_name')}")
    expect(results, "调度到 k3s 节点", (ws.get("node_name") or "") in {n.get("name") for n in tagged}, ws.get("node_name"))

    code, hidden = outsider.req("GET", f"/workspaces/{wid}")
    expect(results, "局外人不能看这台机器", code in (403, 404), f"status={code}")

    code, applied = alice.req("POST", f"/workspaces/{wid}/k8s/apply", {"yaml": DEMO})
    expect(results, "Alice apply Deployment", code == 200, str(applied)[:250])
    ns = (ws.get("runtime_ref") or "").strip()
    if not ns and isinstance(applied, dict):
        rows = applied.get("data") or applied.get("resources") or []
        if rows:
            ns = rows[0].get("namespace") or ""
    expect(results, "拿到命名空间", bool(ns), str(applied)[:160])

    ready = False
    last = ""
    if ns:
        for _ in range(30):
            _, raw, _ = guest_exec(env, K3S_VMID, f"k3s kubectl -n {ns} get po -o wide --request-timeout=20s 2>&1")
            last = guest_text(raw)
            if "story-web" in last and "1/1" in last:
                ready = True
                break
            time.sleep(3)
    expect(results, "真集群 story-web Pod Running", ready, last[-400:])

    code, res = bob.req("GET", f"/workspaces/{wid}/k8s/resources")
    names = [r.get("name") for r in ((res or {}).get("data") or [])]
    expect(results, "developer 能看资源列表", code == 200 and "story-web" in names, str(res)[:240])
    code, st = bob.req("GET", f"/workspaces/{wid}/k8s/status")
    expect(results, "developer 能看 k8s status", code == 200 and isinstance(st, dict) and "summary" in (st or {}), str(st)[:240])

    code, kc = alice.req("GET", f"/workspaces/{wid}/kubeconfig")
    expect(results, "owner 下载 kubeconfig", code == 200 and "kubeconfig" in (kc or {}), str(kc)[:80])
    code, _ = alice.req("POST", f"/workspaces/{wid}/exec", {"command": "uname"})
    expect(results, "k8s 机器拒绝网页 exec", code == 400)

    code, _ = alice.req("POST", f"/workspaces/{wid}/destroy-request", {})
    alice.req("POST", f"/workspaces/{wid}/destroy-request/approve", {})
    admin.req("POST", f"/admin/dangerous-approvals/{wid}/approve", {})
    _, after = alice.req("GET", f"/workspaces/{wid}")
    expect(
        results,
        "销毁走完或进行中",
        (after or {}).get("status")
        in ("destroyed", "destroying", "destroy_requested", "destroy_pending_platform")
        or (after or {}).get("error"),
        str(after)[:200],
    )

    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"\n==> {len(results) - failed}/{len(results)} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
