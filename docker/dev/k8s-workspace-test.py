#!/usr/bin/env python3
"""K8s 工作区故事：开通 → apply → resources → kubeconfig → 销毁。

环境：
  HA_API_BASE   默认 http://127.0.0.1:8080
  HA_ADMIN_USER / HA_ADMIN_PASS
无 k3s 标签节点时创建应返回 409 INSUFFICIENT_CAPACITY（算通过「明确失败」）。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("HA_API_BASE", "http://127.0.0.1:8080").rstrip("/")
ADMIN_USER = os.environ.get("HA_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("HA_ADMIN_PASS", "123456qq")
UA = {"User-Agent": "ha-k8s-workspace-test/1.0"}

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


def api(method, path, body=None, token=""):
    hdrs = {"Content-Type": "application/json", **UA}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
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
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


def main():
    print(f"API {BASE}")
    code, login = api("POST", "/auth/login", {"username": ADMIN_USER, "password": ADMIN_PASS})
    if code != 200 or not login.get("token"):
        print("login failed", code, login)
        sys.exit(2)
    tok = login["token"]
    slug = f"k8slab{int(time.time()) % 100000}"
    code, proj = api("POST", "/projects", {"name": slug, "slug": slug, "purpose": "K8s 工作区测试"}, tok)
    ok("create project", code == 201, str(proj))
    pid = proj.get("id")
    code, ws = api(
        "POST",
        f"/projects/{pid}/workspaces",
        {"name": "k8s-lab", "plan": "nano", "arch": "amd64", "runtime": "k8s"},
        tok,
    )
    if code == 409 and ws.get("error") == "INSUFFICIENT_CAPACITY":
        ok("k8s create fails without tagged node", True)
        print("no k3s-capable node; tag a joined worker with k3s/k8s/both and retry")
        print(f"{passed} passed, {failed} failed")
        sys.exit(0 if failed == 0 else 1)
    ok("create k8s workspace", code == 201 and ws.get("runtime") == "k8s", str(ws))
    wid = ws.get("id")
    status = ws.get("status")
    for _ in range(30):
        if status == "running":
            break
        time.sleep(2)
        _, cur = api("GET", f"/workspaces/{wid}", token=tok)
        status = cur.get("status")
    ok("running", status == "running", status)

    code, applied = api("POST", f"/workspaces/{wid}/k8s/apply", {"yaml": DEMO}, tok)
    ok("apply yaml", code == 200, str(applied))
    code, res = api("GET", f"/workspaces/{wid}/k8s/resources", token=tok)
    names = [r.get("name") for r in (res.get("data") or [])]
    ok("resources contain lab-web", code == 200 and "lab-web" in names, str(res))
    code, kc = api("GET", f"/workspaces/{wid}/kubeconfig", token=tok)
    ok("kubeconfig", code == 200 and "kubeconfig" in kc, str(kc)[:120])

    code, _ = api("POST", f"/workspaces/{wid}/exec", {"command": "uname"}, tok)
    ok("exec rejected", code == 400)

    code, _ = api("POST", f"/workspaces/{wid}/destroy-request", {}, tok)
    if code in (200, 204, 201):
        api("POST", f"/workspaces/{wid}/destroy-request/approve", {}, tok)
    _, after = api("GET", f"/workspaces/{wid}", token=tok)
    ok(
        "destroy requested or gone",
        after.get("status") in ("destroyed", "destroying", "destroy_requested", "destroy_pending_platform")
        or after.get("error"),
        str(after),
    )
    print(f"{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
