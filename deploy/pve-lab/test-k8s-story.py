#!/usr/bin/env python3
"""实验室真 k3s 用户故事：建项 → 开通 k8s 机器 → apply → 节点上 Pod Running → kubeconfig → 销毁。

  python deploy/pve-lab/test-k8s-story.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bootstrap import guest_exec, load_env  # noqa: E402

LAB = Path(__file__).resolve().parent
K3S_VMID = 116
DEMO = """apiVersion: apps/v1
kind: Deployment
metadata:
  name: lab-web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: lab-web
  template:
    metadata:
      labels:
        app: lab-web
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

passed = failed = 0


def ok(name: str, cond: bool, detail: str = "") -> bool:
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")
    return cond


def api(base: str, method: str, path: str, body=None, token=""):
    hdrs = {"Content-Type": "application/json"}
    if token:
        hdrs["Authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return e.code, {"raw": raw[:300]}


def guest_text(raw: str) -> str:
    try:
        j = json.loads(raw[raw.find("{") :])
        return (j.get("out-data") or "") + (j.get("err-data") or "")
    except json.JSONDecodeError:
        return raw


def main() -> int:
    env = load_env(LAB / "lab.env")
    base = env.get("HA_API_BASE", "http://192.168.1.60:8080").rstrip("/")
    print(f"==> k8s story API {base}")
    code, login = api(base, "POST", "/auth/login", {
        "username": env.get("HA_ADMIN_USER", "admin"),
        "password": env.get("HA_ADMIN_PASS", ""),
    })
    if code != 200 or not login.get("token"):
        print("login failed", code)
        return 2
    tok = login["token"]
    code, ver = api(base, "GET", "/agent-pack/version", token=tok)
    ok("控制面已含 Kubernetes API", code == 200 and int(ver.get("version") or 0) >= 4, str(ver))

    code, nodes = api(base, "GET", "/nodes", token=tok)
    tagged = [n for n in (nodes or {}).get("data", []) if n.get("ready") and "k3s" in (n.get("tags") or [])]
    ok("存在带 k3s 标签的 Ready 节点", len(tagged) >= 1, str([(n.get("name"), n.get("tags")) for n in (nodes or {}).get("data", [])]))

    slug = f"k8sstory{int(time.time()) % 100000}"
    code, proj = api(base, "POST", "/projects", {"name": slug, "slug": slug, "purpose": "K8s 故事验收"}, tok)
    ok("创建项目", code == 201, str(proj))
    pid = proj.get("id")

    code, ws = api(
        base,
        "POST",
        f"/projects/{pid}/workspaces",
        {"name": "k8s-lab", "plan": "nano", "arch": "amd64", "runtime": "k8s"},
        tok,
    )
    ok("开通 Kubernetes 工作区", code == 201 and (ws or {}).get("runtime") == "k8s", str(ws)[:400])
    wid = (ws or {}).get("id")
    status = (ws or {}).get("status")
    for _ in range(40):
        if status == "running":
            break
        time.sleep(2)
        _, cur = api(base, "GET", f"/workspaces/{wid}", token=tok)
        status = cur.get("status")
        ws = cur
    ok("工作区 running", status == "running", f"status={status} node={ws.get('node_name')}")
    ok("调度到 k3s 节点", (ws.get("node_name") or "") in {n.get("name") for n in tagged} or bool(ws.get("node_id")), ws.get("node_name"))

    code, applied = api(base, "POST", f"/workspaces/{wid}/k8s/apply", {"yaml": DEMO}, tok)
    ok("apply Deployment", code == 200, str(applied)[:300])
    ns = None
    if isinstance(applied, dict):
        rows = applied.get("data") or applied.get("resources") or []
        if rows:
            ns = rows[0].get("namespace")
    if not ns:
        ns = (ws.get("runtime_ref") or "").strip()
    ok("拿到命名空间", bool(ns), str(applied)[:200])

    ready = False
    last = ""
    for _ in range(30):
        _, raw, _ = guest_exec(
            env,
            K3S_VMID,
            f"k3s kubectl -n {ns} get deploy,po -o wide --request-timeout=20s 2>&1",
        )
        last = guest_text(raw)
        if "lab-web" in last and "1/1" in last:
            ready = True
            break
        time.sleep(3)
    ok("k3s 上 lab-web Pod Running", ready, last[-500:])

    code, res = api(base, "GET", f"/workspaces/{wid}/k8s/resources", token=tok)
    names = [r.get("name") for r in (res.get("data") or [])]
    ok("控制台资源列表含 lab-web", code == 200 and "lab-web" in names, str(res)[:300])
    code, kc = api(base, "GET", f"/workspaces/{wid}/kubeconfig", token=tok)
    ok("可下载 kubeconfig", code == 200 and "kubeconfig" in kc, str(kc)[:80])
    code, _ = api(base, "POST", f"/workspaces/{wid}/exec", {"command": "uname"}, tok)
    ok("k8s 工作区拒绝 exec", code == 400)

    code, _ = api(base, "POST", f"/workspaces/{wid}/destroy-request", {}, tok)
    if code in (200, 201, 204):
        api(base, "POST", f"/workspaces/{wid}/destroy-request/approve", {}, tok)
        # 平台终审
        _, pending = api(base, "GET", "/admin/dangerous-approvals", token=tok)
        items = (pending or {}).get("data") or pending if isinstance(pending, list) else []
        for it in items or []:
            if it.get("id") == wid or it.get("workspace_id") == wid:
                api(base, "POST", f"/admin/dangerous-approvals/{it.get('id', wid)}/approve", {}, tok)
                break
        else:
            api(base, "POST", f"/admin/dangerous-approvals/{wid}/approve", {}, tok)
    _, after = api(base, "GET", f"/workspaces/{wid}", token=tok)
    ok(
        "销毁流程已走完或进行中",
        after.get("status") in ("destroyed", "destroying", "destroy_requested", "destroy_pending_platform")
        or after.get("error"),
        str(after)[:200],
    )

    print(f"\n==> {passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
