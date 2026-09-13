#!/usr/bin/env python3
"""Validate dual-active compose / nginx without touching production."""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
COMPOSE = (ROOT / "docker-compose.yaml").read_text(encoding="utf-8")
NGINX = (ROOT / "edge" / "nginx.conf").read_text(encoding="utf-8")


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def check_compose() -> None:
    for svc in ("ha-api-a:", "ha-api-b:", "postgres:"):
        if svc not in COMPOSE:
            fail(f"compose missing service {svc}")
    if re.search(r"(?m)^  ha-api:\s*$", COMPOSE):
        fail("compose still has singleton service ha-api")
    if re.search(r"container_name:\s*ha-api\s*$", COMPOSE) and "ha-api-a" not in COMPOSE:
        fail("compose still pins container_name ha-api")
    if "container_name: ha-api\n" in COMPOSE or "container_name: ha-api\r\n" in COMPOSE:
        fail("compose still pins singleton container_name ha-api")
    if "memory: 512M" not in COMPOSE:
        fail("api memory limit should be 512M")
    if "ha-api-a" not in COMPOSE or "ha-api-b" not in COMPOSE:
        fail("both api slots required")


def check_nginx() -> None:
    if "ha-api-a:8080" not in NGINX or "ha-api-b:8080" not in NGINX:
        fail("nginx upstream must list ha-api-a and ha-api-b")
    if re.search(r"server\s+ha-api:8080\s*;", NGINX):
        fail("nginx still points at singleton ha-api")
    if "proxy_next_upstream" not in NGINX:
        fail("nginx must retry the other slot on 502/503")


def simulate_one_down() -> None:
    """Document the fail-over contract used by rolling-up.sh."""
    slots = ["ha-api-a:8080", "ha-api-b:8080"]
    down = "ha-api-a:8080"
    up = [s for s in slots if s != down]
    if not up:
        fail("no remaining slot if one API is down")
    if "max_fails=2" not in NGINX:
        fail("nginx must mark a dead slot failed quickly")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.parse_args()
    check_compose()
    check_nginx()
    simulate_one_down()
    print("OK: dual-active compose + nginx")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
