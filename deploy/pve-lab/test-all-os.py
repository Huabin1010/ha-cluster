#!/usr/bin/env python3
"""在三套 Ubuntu 测试 VM 上并行跑 worker 安装（离线 Incus + 清华 apt）。"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))
from bootstrap import depot_url, guest_exec, load_env, verify_depot  # noqa: E402


def install_node(env: dict, node: dict, staging: str) -> tuple[str, float, str]:
    vmid = node["vmid"]
    name = node["name"]
    fabric = node["fabric_ip"]
    api = env.get("HA_API_BASE", "http://192.168.1.100:8080")
    token = env.get("HA_NODE_TOKEN", "ha-test-node-token-2026")
    skip_incus = env.get("SKIP_INCUS", "0")
    skip_et = env.get("SKIP_EASYTIER", "1")
    install_mode = env.get("HA_INSTALL_MODE", "offline")
    apt_mirror = env.get("HA_APT_MIRROR", "tuna")
    verify_egress = env.get("HA_VERIFY_EGRESS", "0")

    body = (
        f"export STAGING='{staging}' DEPOT_PUBLIC='{staging}' NODE_NAME='{name}' FABRIC_IP='{fabric}' "
        f"HA_API_BASE='{api}' HA_NODE_TOKEN='{token}' "
        f"SKIP_INCUS='{skip_incus}' SKIP_EASYTIER='{skip_et}' "
        f"HA_INSTALL_MODE='{install_mode}' HA_APT_MIRROR='{apt_mirror}' "
        f"HA_VERIFY_EGRESS='{verify_egress}'; "
        f"curl --connect-timeout 10 --max-time 60 -fsSL '{staging}/lab/reinstall.sh' -o /tmp/ha-r.sh && bash /tmp/ha-r.sh"
    )
    code, out, elapsed = guest_exec(env, vmid, body)
    if code != 0 or "==> done" not in out:
        raise RuntimeError(f"{name} ({node.get('codename')}) failed in {elapsed:.1f}s:\n{out[-800:]}")
    return name, elapsed, out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="jammy,noble,resolute comma-separated")
    ap.add_argument("--use-public", action="store_true")
    args = ap.parse_args()

    env = load_env(LAB / "lab.env")
    env.setdefault("SKIP_INCUS", "0")
    env.setdefault("HA_INSTALL_MODE", "offline")
    env.setdefault("HA_APT_MIRROR", "tuna")
    staging = depot_url(env, args.use_public)
    nodes = json.loads((LAB / "nodes.json").read_text(encoding="utf-8"))
    if args.only:
        allow = {x.strip() for x in args.only.split(",")}
        nodes = [n for n in nodes if n.get("codename") in allow]

    verify_depot(staging)
    t0 = time.perf_counter()
    print(f"==> test install on {len(nodes)} VMs (mode={env['HA_INSTALL_MODE']}, apt={env['HA_APT_MIRROR']})")

    results: list[tuple[str, float]] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=len(nodes)) as pool:
        futs = {pool.submit(install_node, env, n, staging): n for n in nodes}
        for fut in as_completed(futs):
            n = futs[fut]
            try:
                name, elapsed, _ = fut.result()
                results.append((name, elapsed))
                print(f"  OK {name} ({n['codename']}) {elapsed:.1f}s")
            except Exception as e:
                errors.append(str(e))
                print(f"  FAIL {n['name']}: {e}", file=sys.stderr)

    print("\n=== 汇总 ===")
    for name, sec in sorted(results):
        print(f"  {name}: {sec:.1f}s")
    print(f"  total: {time.perf_counter() - t0:.1f}s")
    if errors:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
