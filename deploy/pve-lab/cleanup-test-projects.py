#!/usr/bin/env python3
"""删除除指定项目外的所有测试项目。"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://192.168.1.100:8080"
KEEP_ID = "7fc80fa8-71f1-483d-81e9-6f6546db35a7"  # pve-lab / lab-ws1 running


def api(method: str, path: str, token: str, body=None) -> tuple[int, dict]:
    hdrs = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return e.code, {"raw": raw.decode()[:300]}


def main() -> int:
    _, login = api("POST", "/auth/login", "", {"username": "admin", "password": "123456qq"})
    token = login["token"]
    _, projects = api("GET", "/projects", token)
    items = projects.get("data", projects)
    deleted: list[str] = []
    failed: list[tuple[str, int, dict]] = []
    for p in items:
        if p["id"] == KEEP_ID:
            continue
        code, res = api("DELETE", f"/projects/{p['id']}", token)
        if code in (200, 204):
            deleted.append(p.get("slug", p.get("name", p["id"])))
            print(f"  deleted {p.get('name')} ({p.get('slug')})")
        else:
            failed.append((p.get("slug", "?"), code, res))
            print(f"  FAIL {p.get('slug')} {code} {res}", file=sys.stderr)
        time.sleep(0.15)
    _, left = api("GET", "/projects", token)
    left_items = left.get("data", left)
    print(f"\n==> deleted {len(deleted)}, failed {len(failed)}, remaining {len(left_items)}")
    for p in left_items:
        print(f"  keep: {p.get('name')} / {p.get('slug')} / {p['id']}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
