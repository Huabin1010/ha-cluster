#!/usr/bin/env python3
"""Bootstrap production control plane: login, ingress zones, join token."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("HA_API_BASE", "http://127.0.0.1:18082").rstrip("/")
USER = os.environ.get("HA_ADMIN_USER", "admin")
PASS = os.environ.get("HA_ADMIN_PASSWORD", "123456qq")


def req(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return e.code, parsed


def main() -> int:
    code, login = req("POST", "/api/auth/login", {"username": USER, "password": PASS})
    if code >= 400:
        # some builds use /auth/login without /api when already under /api base
        code, login = req("POST", "/auth/login", {"username": USER, "password": PASS})
    if code >= 400 or "token" not in login:
        print("login failed", code, login, file=sys.stderr)
        return 1
    token = login["token"]
    print("login ok")

    zones = [
        {
            "suffix": "cl.qzsyzn.com",
            "display_name": "平台主域",
            "require_approval": False,
            "enabled": True,
            "allow_random": True,
            "allow_custom_prefix": True,
            "sort_order": 10,
        },
        {
            "suffix": "apps.cl.qzsyzn.com",
            "display_name": "公共应用域",
            "require_approval": False,
            "enabled": True,
            "allow_random": True,
            "allow_custom_prefix": True,
            "sort_order": 20,
        },
    ]
    for z in zones:
        code, out = req("POST", "/api/admin/ingress-domains", z, token)
        if code == 404:
            code, out = req("POST", "/admin/ingress-domains", z, token)
        print("zone", z["suffix"], code, json.dumps(out, ensure_ascii=False)[:200])

    join_body = {
        "api": "https://cl.qzsyzn.com/api",
        "use_lan_depot": False,
        "fabric_ip": os.environ.get("HA_JOIN_FABRIC_IP", "10.129.129.208"),
    }
    code, join = req("POST", "/api/admin/join-tokens", join_body, token)
    if code == 404:
        code, join = req("POST", "/admin/join-tokens", join_body, token)
    print("join", code)
    print(json.dumps(join, ensure_ascii=False, indent=2))
    if code < 300 and join.get("command"):
        Path = __import__("pathlib").Path
        out = Path(os.environ.get("HA_JOIN_OUT", "/tmp/ha-prod-join.json"))
        out.write_text(json.dumps(join, ensure_ascii=False, indent=2), encoding="utf-8")
        print("wrote", out)
    return 0 if code < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())
