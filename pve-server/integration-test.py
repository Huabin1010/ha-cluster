#!/usr/bin/env python3
"""
API integration test for ha-cluster full enhancement plan.
Run against live ha-api (default http://127.0.0.1:8080).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("HA_API_BASE", "http://127.0.0.1:8080").rstrip("/")
ADMIN_USER = os.environ.get("HA_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("HA_ADMIN_PASS", "adminadmin")
NODE_TOKEN = os.environ.get("HA_NODE_TOKEN", "ha-test-node-token-2026")

passed = 0
failed = 0


def api(method: str, path: str, body=None, token: str = "", headers: dict | None = None):
    url = BASE + path
    data = None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return e.code, payload


def api_text(method: str, path: str, token: str = ""):
    hdrs = {}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, resp.read().decode()


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


def main() -> int:
    print(f"=== ha-cluster API integration @ {BASE} ===\n")

    # P0: health
    code, _ = api("GET", "/healthz")
    check("healthz", code == 200)
    code, _ = api("GET", "/readyz")
    check("readyz", code == 200)

    # P2: metrics
    code, metrics = api_text("GET", "/metrics")
    check("metrics endpoint", code == 200 and "ha_nodes_ready" in metrics, metrics[:80])
    check("metrics has http_requests", "ha_http_requests_total" in metrics)

    # Auth: admin login (consistent User-Agent for fingerprint binding)
    ua = {"User-Agent": "ha-integration-test/1.0"}
    code, login = api(
        "POST",
        "/auth/login",
        {"username": ADMIN_USER, "password": ADMIN_PASS},
        headers=ua,
    )
    check("admin login", code == 200 and "token" in login, str(login))
    token = login.get("token", "")
    refresh = login.get("refresh_token", "")

    # P4: refresh with fingerprint header
    code, ref = api(
        "POST",
        "/auth/refresh",
        {"refresh_token": refresh},
        headers={"User-Agent": "ha-integration-test/1.0"},
    )
    check("refresh token", code == 200 and "token" in ref, str(ref))
    token = ref.get("token", token)

    # P1/P2: node heartbeat (simulate 4th node)
    hb_body = {
        "name": "integration-probe",
        "arch": "amd64",
        "role": "worker",
        "class": "desktop",
        "power": "mains",
        "fabric_ip": "192.168.1.199",
        "allocatable_cpu_milli": 4000,
        "allocatable_mem_bytes": 3 * 1024**3,
        "allocatable_disk_bytes": 25 * 1024**3,
        "cpu_usage_pct": 12.5,
        "mem_available_bytes": 2 * 1024**3,
        "disk_free_bytes": 20 * 1024**3,
        "fabric_path": "p2p",
        "fabric_rtt_ms": 2,
    }
    req = urllib.request.Request(
        BASE + "/nodes/heartbeat",
        data=json.dumps(hb_body).encode(),
        headers={
            "Content-Type": "application/json",
            "X-HA-Node-Token": NODE_TOKEN,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        check("heartbeat register", resp.status == 200)

    # List nodes - expect ha-test-01/02/03 from agents
    code, nodes_resp = api("GET", "/nodes", token=token)
    nodes = nodes_resp.get("data", nodes_resp) if isinstance(nodes_resp, dict) else nodes_resp
    if isinstance(nodes_resp, dict) and "data" in nodes_resp:
        nodes = nodes_resp["data"]
    names = {n.get("name") for n in nodes} if isinstance(nodes, list) else set()
    check("nodes list", code == 200, str(names))
    for expected in ("ha-test-01", "ha-test-02", "ha-test-03"):
        check(f"node {expected} registered", expected in names, f"got {names}")

    # Capacity
    code, cap = api("GET", "/capacity", token=token)
    check("capacity", code == 200 and "pools" in cap, str(cap)[:120])

    # Project + workspace lifecycle
    slug = f"integration-test-{int(time.time())}"
    code, proj = api(
        "POST",
        "/projects",
        token=token,
        body={"name": "integration-test", "slug": slug},
    )
    check("create project", code == 201, str(proj))
    pid = proj.get("id", "")

    code, ws = api(
        "POST",
        f"/projects/{pid}/workspaces",
        token=token,
        body={"name": "ws1", "plan": "nano", "arch": "amd64"},
    )
    check("create workspace", code == 201, str(ws)[:200])
    ws_id = ws.get("id", "")

    if ws_id:
        code, _ = api("GET", f"/workspaces/{ws_id}", token=token)
        check("get workspace", code == 200)
        code, _ = api("POST", f"/workspaces/{ws_id}/stop", token=token)
        check("stop workspace", code == 200)
        code, started = api("POST", f"/workspaces/{ws_id}/start", token=token)
        check("start workspace", code == 200, str(started)[:100])

        # P3: hot resize
        code, resized = api(
            "POST",
            f"/workspaces/{ws_id}/resize",
            token=token,
            body={"cpu_milli": 2000, "mem_bytes": 1024**3, "disk_bytes": 10 * 1024**3},
        )
        check("resize workspace", code == 200, str(resized)[:120])

    # P4: ingress domain blacklist
    if ws_id:
        code, ing = api(
            "POST",
            f"/workspaces/{ws_id}/ingress",
            token=token,
            body={"domain": "admin.evil.test", "port": 8080, "path": "/"},
        )
        check("ingress blacklist blocks admin", code == 400, str(ing))

    # P4: login rate limit
    locked = False
    for i in range(6):
        code, body = api(
            "POST",
            "/auth/login",
            {"username": "rate-limit-probe", "password": "wrong"},
            headers={"X-Forwarded-For": "203.0.113.99"},
        )
        if code == 429:
            locked = True
            break
    check("login rate limit 429", locked, f"last code={code}")

    # P5: reconcile
    code, rec = api("POST", "/admin/reconcile", token=token)
    check("admin reconcile", code == 200 and "released" in rec, str(rec))

    # Audit logs
    code, audit = api("GET", "/audit-logs", token=token)
    check("audit logs", code == 200, str(audit)[:80])

    print(f"\n=== Result: {passed} passed, {failed} failed ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
