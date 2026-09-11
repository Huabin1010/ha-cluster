#!/usr/bin/env python3
"""通过 API 创建真实 Workspace 并等待 running。"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))
from bootstrap import load_env  # noqa: E402


def api(base: str, method: str, path: str, body=None, token: str = "", node_token: str = ""):
    hdrs = {"Content-Type": "application/json"}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    if node_token:
        hdrs["X-HA-Node-Token"] = node_token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers=hdrs, method=method)
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--node", default="", help="prefer node name, e.g. ha-test-jammy")
    ap.add_argument("--plan", default="small")
    ap.add_argument("--timeout", type=int, default=300)
    args = ap.parse_args()

    env = load_env(LAB / "lab.env")
    base = env.get("HA_API_BASE", "http://192.168.1.100:8080").rstrip("/")
    admin_user = env.get("HA_ADMIN_USER", "admin")
    admin_pass = env.get("HA_ADMIN_PASS", "123456qq")

    print(f"==> API {base}")
    code, _ = api(base, "GET", "/healthz")
    if code != 200:
        print(f"FAIL healthz {code}", file=sys.stderr)
        return 1

    code, login = api(base, "POST", "/auth/login", {"username": admin_user, "password": admin_pass})
    if code != 200 or "token" not in login:
        print(f"FAIL login {code} {login}", file=sys.stderr)
        return 1
    token = login["token"]

    code, nodes_resp = api(base, "GET", "/nodes", token=token)
    nodes = nodes_resp.get("data", nodes_resp) if isinstance(nodes_resp, dict) else nodes_resp
    if not isinstance(nodes, list):
        print(f"FAIL nodes list {code} {nodes_resp}", file=sys.stderr)
        return 1
    ready = [n for n in nodes if n.get("status") in ("ready", "Ready", None) or n.get("ready")]
    names = [n.get("name") for n in nodes]
    print(f"==> nodes ({len(nodes)}): {', '.join(names)}")
    if not nodes:
        print("FAIL: no nodes registered — ensure ha-agent heartbeats", file=sys.stderr)
        return 1

    slug = f"ws-lab-{int(time.time())}"
    code, proj = api(base, "POST", "/projects", token=token, body={"name": "pve-lab", "slug": slug})
    if code not in (200, 201):
        print(f"FAIL create project {code} {proj}", file=sys.stderr)
        return 1
    pid = proj["id"]
    print(f"==> project {slug} ({pid})")

    ws_body = {"name": "lab-ws1", "plan": args.plan, "arch": "amd64"}
    if args.node:
        ws_body["node_name"] = args.node
    code, ws = api(base, "POST", f"/projects/{pid}/workspaces", token=token, body=ws_body)
    if code not in (200, 201):
        print(f"FAIL create workspace {code} {ws}", file=sys.stderr)
        return 1
    ws_id = ws.get("id", "")
    print(f"==> workspace {ws_id} status={ws.get('status')} node={ws.get('node_name')}")

    deadline = time.time() + args.timeout
    last = ws
    while time.time() < deadline:
        code, cur = api(base, "GET", f"/workspaces/{ws_id}", token=token)
        if code != 200:
            print(f"warn get workspace {code}")
            time.sleep(3)
            continue
        last = cur
        status = cur.get("status")
        print(f"  ... status={status}")
        if status in ("running", "failed", "stopped"):
            break
        time.sleep(5)

    node_name = last.get("node_name")
    if not node_name and last.get("node_id"):
        for n in nodes:
            if n.get("id") == last.get("node_id"):
                node_name = n.get("name")
                break
    print(f"\n==> final: {json.dumps(last, indent=2)[:2000]}")
    print(f"==> node={node_name} ssh_port={last.get('ssh_port')} status={last.get('status')}")
    if last.get("status") != "running":
        print(f"FAIL workspace not running: {last.get('status')}", file=sys.stderr)
        return 1

    # 在分配节点上确认 incus 实例存在
    node_name = last.get("node_name") or args.node
    nodes_map = {n["name"]: n for n in nodes}
    target = next((n for n in nodes if n.get("name") == node_name), None)
    if target:
        vmid = target.get("vmid")
        if not vmid:
            nj = json.loads((LAB / "nodes.json").read_text(encoding="utf-8"))
            vmid = next((x["vmid"] for x in nj if x["name"] == node_name), None)
        if vmid:
            import subprocess

            inst = last.get("incus_name") or last.get("instance_name") or f"ws-{ws_id[:8]}"
            cmd = (
                f"qm guest exec {vmid} --timeout 60 -- "
                f"incus list -c n,s,4 --format csv | grep -E '{inst}|NAME' || incus list"
            )
            r = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", f"root@{env.get('PVE_HOST','192.168.1.8')}", cmd],
                capture_output=True,
                text=True,
                timeout=90,
            )
            print(f"\n==> incus on {node_name} (VM {vmid}):\n{r.stdout or r.stderr}")

    print("\n==> workspace OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
