#!/usr/bin/env python3
"""在三套测试 VM 上启动 Incus 容器并验收。"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))
from bootstrap import guest_exec, load_env  # noqa: E402


def test_vm(env: dict, vmid: int, name: str, codename: str) -> tuple[str, float]:
    cname = f"ha-smoke-{vmid}"
    body = (
        f"set -e; "
        f"incus launch ha-ubuntu-24.04 {cname} --ephemeral; "
        f"incus exec {cname} -- hostname; "
        f"incus exec {cname} -- head -2 /etc/os-release; "
        f"incus delete {cname} --force; "
        f"echo launch_ok"
    )
    code, out, elapsed = guest_exec(env, vmid, body)
    if code != 0 or "launch_ok" not in out:
        raise RuntimeError(f"{name} ({codename}) failed in {elapsed:.1f}s:\n{out[-1200:]}")
    return name, elapsed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="jammy,noble,resolute")
    args = ap.parse_args()

    env = load_env(LAB / "lab.env")
    nodes = json.loads((LAB / "nodes.json").read_text(encoding="utf-8"))
    if args.only:
        allow = {x.strip() for x in args.only.split(",")}
        nodes = [n for n in nodes if n.get("codename") in allow]

    t0 = time.perf_counter()
    print(f"==> incus launch test on {len(nodes)} VMs")
    errors: list[str] = []
    for n in nodes:
        try:
            name, sec = test_vm(env, n["vmid"], n["name"], n["codename"])
            print(f"  OK {name} ({n['codename']}) {sec:.1f}s")
        except Exception as e:
            errors.append(str(e))
            print(f"  FAIL {n['name']}: {e}", file=sys.stderr)

    print(f"\n==> total {time.perf_counter() - t0:.1f}s")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
