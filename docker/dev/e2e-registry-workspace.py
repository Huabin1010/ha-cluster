#!/usr/bin/env python3
"""PVE 实验室 E2E：镜像仓库 → 异步创建 Workspace → config.json → docker pull。

环境变量：
  HA_API_BASE          默认 http://127.0.0.1:8080
  HA_ADMIN_PASS        默认 123456qq
  HA_PVE_HOST          默认 192.168.1.8
  HA_REGISTRY_1MS_PASS / HA_REGISTRY_CNB_PASS  或 tmp/ha.md
  HA_E2E_PLAN          默认 small（container 离线装 docker 勿用 nano）
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

# 复用 deploy/pve-lab/pve_guest.py
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "deploy", "pve-lab"))
from pve_guest import NODE_VMID, guest, workspace_inst_name  # noqa: E402

BASE = os.environ.get("HA_API_BASE", "http://127.0.0.1:8080").rstrip("/")
ADMIN_PASS = os.environ.get("HA_ADMIN_PASS", "123456qq")
E2E_PLAN = os.environ.get("HA_E2E_PLAN", "small")
POLL_TIMEOUT = int(os.environ.get("HA_E2E_POLL_TIMEOUT", "180"))

REG_1MS_PASS = os.environ.get("HA_REGISTRY_1MS_PASS", "")
REG_CNB_PASS = os.environ.get("HA_REGISTRY_CNB_PASS", "")

passed = failed = 0


def load_ha_md() -> None:
    global REG_1MS_PASS, REG_CNB_PASS
    ha_md = os.path.join(ROOT, "tmp", "ha.md")
    if not os.path.isfile(ha_md):
        return
    with open(ha_md, encoding="utf-8") as f:
        for line in f:
            if "docker.1ms.run" in line and "-p" in line and not REG_1MS_PASS:
                REG_1MS_PASS = line.split("-p", 1)[1].strip()
            if "docker.cnb.cool" in line and "-p" in line and not REG_CNB_PASS:
                REG_CNB_PASS = line.split("-p", 1)[1].strip()


def api(method: str, path: str, body=None, token: str = "", timeout: int = 60):
    hdrs = {"Content-Type": "application/json"}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {(detail or '')[:500]}")


def login() -> str:
    code, body = api("POST", "/auth/login", {"username": "admin", "password": ADMIN_PASS})
    if code != 200 or "token" not in body:
        raise SystemExit(f"login failed: {code} {body}")
    return body["token"]


def ensure_registries(token: str) -> None:
    print("── 镜像仓库 ──")
    code, existing = api("GET", "/admin/docker-registries", token=token)
    check("list docker registries", code == 200, str(existing)[:200])
    have = {r["server"] for r in existing.get("data", [])}
    for reg in [
        {"name": "1ms 镜像加速", "server": "docker.1ms.run", "username": "1ms", "password": REG_1MS_PASS, "auto_inject": True},
        {"name": "CNB 镜像", "server": "docker.cnb.cool", "username": "cnb", "password": REG_CNB_PASS, "auto_inject": True},
    ]:
        if not reg["password"]:
            print(f"    SKIP {reg['server']} (no password)")
            continue
        if reg["server"] in have:
            print(f"    SKIP {reg['server']} (exists)")
            continue
        code, created = api("POST", "/admin/docker-registries", reg, token=token)
        print(f"    create {reg['server']}: {code}")
        if code in (200, 201) and created.get("id"):
            code, test = api("POST", f"/admin/docker-registries/{created['id']}/test", token=token)
            check(f"probe {reg['server']}", code == 200 and (test.get("ok") or test.get("success")), str(test)[:200])


def project_id(token: str) -> str:
    code, projects = api("GET", "/projects", token=token)
    for p in projects.get("data", []):
        if p.get("slug") == "e2e-lab":
            return p["id"]
    code, proj = api("POST", "/projects", {"name": "E2E Lab", "slug": "e2e-lab"}, token=token)
    if code not in (200, 201):
        raise SystemExit(f"create project: {code} {proj}")
    return proj["id"]


def wait_running(token: str, ws_id: str) -> dict:
    deadline = time.time() + POLL_TIMEOUT
    last: dict = {}
    while time.time() < deadline:
        code, cur = api("GET", f"/workspaces/{ws_id}", token=token)
        if code == 200:
            last = cur
            status = cur.get("status")
            print(f"    poll: {status}")
            if status == "running":
                return cur
            if status in ("failed", "destroyed"):
                return cur
        time.sleep(8)
    return last


def verify_on_node(node_name: str, inst: str) -> None:
    vmid = NODE_VMID[node_name]
    print(f"\n── 容器验收 {inst} @ {node_name} (vm {vmid}) ──")

    code, out = guest(vmid, f"incus list --format csv | grep {inst} || echo MISSING")
    check(f"incus {inst} running", "RUNNING" in out, out.strip()[:200])

    code, out = guest(vmid, f"incus exec {inst} -- docker --version")
    check("docker installed", "Docker version" in out, out.strip()[:120])

    code, out = guest(
        vmid,
        f"incus exec {inst} -- bash -lc 'test -f /root/.docker/config.json && cat /root/.docker/config.json'",
    )
    check("config.json present", "auths" in out, out[:200])
    check("config docker.1ms.run", "docker.1ms.run" in out, out[:200])
    check("config docker.cnb.cool", "docker.cnb.cool" in out, out[:200])

    # 等待 eth0 DHCP（Launch 后偶发未就绪）
    for i in range(30):
        code, out = guest(
            vmid,
            f"incus exec {inst} -- bash -lc \"ip -4 addr show eth0 | grep -q 'inet '\"",
        )
        if code == 0:
            break
        time.sleep(2)
    else:
        guest(vmid, f"incus restart {inst} --force")
        time.sleep(10)

    code, out = guest(
        vmid,
        f"incus exec {inst} -- docker pull docker.1ms.run/library/alpine:latest",
        timeout=300,
    )
    ok = code == 0 and any(x in out.lower() for x in ("pull complete", "up to date", "downloaded", "digest:"))
    check("docker pull alpine", ok, out.strip()[-400:])


def main() -> int:
    load_ha_md()
    print(f"=== E2E registry + workspace @ {BASE} (plan={E2E_PLAN}) ===\n")

    token = login()
    check("admin login", True)

    ensure_registries(token)

    print("\n── 创建 Workspace（异步 provision）──")
    pid = project_id(token)
    ts = int(time.time())
    code, ws = api(
        "POST",
        f"/projects/{pid}/workspaces",
        {"name": f"pull-e2e-{ts}", "plan": E2E_PLAN, "arch": "amd64"},
        token=token,
        timeout=30,
    )
    check("create workspace accepted", code in (200, 201), str(ws)[:300])
    ws_id = ws.get("id", "")
    if not ws_id:
        print(f"\n=== {passed} passed, {failed} failed ===")
        return 1
    print(f"    id={ws_id} initial_status={ws.get('status')}")
    cur = wait_running(token, ws_id)
    check("workspace running", cur.get("status") == "running", str(cur)[:300])
    if cur.get("status") != "running":
        print(f"\n=== {passed} passed, {failed} failed ===")
        return 1

    node_id = cur.get("node_id")
    _, nodes = api("GET", "/nodes", token=token)
    node = next((n for n in nodes.get("data", []) if n["id"] == node_id), None)
    if not node:
        check("resolve node", False, node_id or "")
        return 1

    inst = workspace_inst_name(ws_id)
    print(f"    node={node['name']} inst={inst} ssh_port={cur.get('ssh_port')}")
    verify_on_node(node["name"], inst)

    print(f"\n=== {passed} passed, {failed} failed ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
