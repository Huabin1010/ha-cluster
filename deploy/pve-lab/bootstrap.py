#!/usr/bin/env python3
"""
PVE 测试 Worker 一键安装（从局域网 RustFS Depot 拉包）。

  python deploy/pve-lab/pack.py              # 仅打包
  python deploy/pve-lab/upload.py            # 上传 Depot（发布用，不必每次跑）
  python deploy/pve-lab/bootstrap.py         # 并行安装 + 验收

选项：
  --skip-reset   不重置，仅覆盖安装
  --use-public   用公网 Depot（默认 lab.env 里 DEPOT_PUBLIC 指向局域网 RustFS）
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "packaging"))
from depot_layout import DEPOT_LAN_URL, DEPOT_PUBLIC_URL  # noqa: E402

GUEST_TIMEOUT = 1800  # bake docker into image can take several minutes


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        sys.exit(f"missing {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("\r")
    return out


def depot_url(env: dict[str, str], use_public: bool) -> str:
    if use_public:
        return DEPOT_PUBLIC_URL.rstrip("/")
    return env.get("DEPOT_PUBLIC", DEPOT_LAN_URL).rstrip("/")


def verify_depot(base: str) -> None:
    try:
        urllib.request.urlopen(f"{base}/lab/install.sh", timeout=15)
    except urllib.error.URLError as e:
        sys.exit(f"Depot 不可达 {base}: {e}")


def guest_exec(env: dict[str, str], vmid: int, bash_body: str) -> tuple[int, str, float]:
    host = env.get("PVE_HOST", "192.168.1.8")
    user = env.get("PVE_USER", "root")
    inner = bash_body.replace("'", "'\"'\"'")
    remote = f"qm guest exec {vmid} --timeout {GUEST_TIMEOUT} -- bash -lc '{inner}'"
    t0 = time.perf_counter()
    cp = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", f"{user}@{host}", remote],
        capture_output=True,
        text=True,
        timeout=GUEST_TIMEOUT,
    )
    elapsed = time.perf_counter() - t0
    out = (cp.stdout or "") + (cp.stderr or "")
    m = re.search(r'"exitcode"\s*:\s*(\d+)', out)
    code = int(m.group(1)) if m else (0 if cp.returncode == 0 else 1)
    return code, out, elapsed


def install_one(env: dict[str, str], node: dict, staging: str, skip_reset: bool) -> tuple[str, float, str]:
    vmid, name, fabric = node["vmid"], node["name"], node["fabric_ip"]
    api = env.get("HA_API_BASE", "http://192.168.1.100:8080")
    token = env.get("HA_NODE_TOKEN", "ha-test-node-token-2026")
    skip_incus = env.get("SKIP_INCUS", "1")
    skip_et = env.get("SKIP_EASYTIER", "1")
    install_mode = env.get("HA_INSTALL_MODE", "offline")
    apt_mirror = env.get("HA_APT_MIRROR", "tuna")
    verify_egress = env.get("HA_VERIFY_EGRESS", "0")
    et_secret = env.get("HA_ET_SECRET", "")
    et_peers = env.get("HA_ET_PEERS", "")
    et_net = env.get("HA_ET_NET", "ha-cluster-easytier")
    et_extra = (
        f"HA_ET_NET='{et_net}' HA_ET_SECRET='{et_secret}' HA_ET_PEERS='{et_peers}' "
        if skip_et != "1" and et_secret
        else ""
    )

    if skip_reset:
        script = "install.sh"
        body = (
            f"export STAGING='{staging}' DEPOT_PUBLIC='{staging}' NODE_NAME='{name}' FABRIC_IP='{fabric}' "
            f"HA_API_BASE='{api}' HA_NODE_TOKEN='{token}' "
            f"SKIP_INCUS='{skip_incus}' SKIP_EASYTIER='{skip_et}' "
            f"HA_INSTALL_MODE='{install_mode}' HA_APT_MIRROR='{apt_mirror}' "
            f"HA_VERIFY_EGRESS='{verify_egress}' {et_extra}; "
            f"curl --connect-timeout 5 --max-time 30 -fsSL '{staging}/lab/{script}' -o /tmp/ha-i.sh && bash /tmp/ha-i.sh"
        )
    else:
        body = (
            f"export STAGING='{staging}' DEPOT_PUBLIC='{staging}' NODE_NAME='{name}' FABRIC_IP='{fabric}' "
            f"HA_API_BASE='{api}' HA_NODE_TOKEN='{token}' "
            f"SKIP_INCUS='{skip_incus}' SKIP_EASYTIER='{skip_et}' "
            f"HA_INSTALL_MODE='{install_mode}' HA_APT_MIRROR='{apt_mirror}' "
            f"HA_VERIFY_EGRESS='{verify_egress}' {et_extra}; "
            f"curl --connect-timeout 5 --max-time 30 -fsSL '{staging}/lab/reinstall.sh' -o /tmp/ha-r.sh && bash /tmp/ha-r.sh"
        )

    code, out, elapsed = guest_exec(env, vmid, body)
    if code != 0 or "==> done" not in out:
        raise RuntimeError(f"{name} failed in {elapsed:.1f}s: {out[-400:]}")
    return name, elapsed, out


def verify_api(api: str, names: list[str]) -> None:
    login = json.dumps({"username": "admin", "password": "123456qq"}).encode()
    req = urllib.request.Request(api.rstrip("/") + "/auth/login", data=login, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        tok = json.loads(r.read())["token"]
    req2 = urllib.request.Request(api.rstrip("/") + "/nodes", headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req2, timeout=10) as r:
        nodes = json.loads(r.read()).get("data", [])
    found = {n.get("name") for n in nodes if n.get("ready")}
    missing = [n for n in names if n not in found]
    if missing:
        raise RuntimeError(f"nodes not ready: {missing}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-reset", action="store_true")
    ap.add_argument("--use-public", action="store_true", help="用公网 Depot（默认局域网 RustFS 192.168.1.9:10000）")
    args = ap.parse_args()

    env = load_env(LAB / "lab.env")
    staging = depot_url(env, args.use_public)
    api = env.get("HA_API_BASE", "http://192.168.1.100:8080")
    nodes = json.loads((LAB / "nodes.json").read_text(encoding="utf-8"))
    names = [n["name"] for n in nodes]

    t_all = time.perf_counter()
    print(f"==> Depot: {staging}")
    verify_depot(staging)

    print(f"==> 并行安装 {len(nodes)} 台 (timeout={GUEST_TIMEOUT}s/台)")
    errors: list[str] = []
    for n in nodes:
        try:
            name, elapsed, _ = install_one(env, n, staging, args.skip_reset)
            print(f"  OK {name} ({elapsed:.1f}s)")
        except Exception as e:
            errors.append(str(e))
            print(f"  FAIL {n['name']}: {e}", file=sys.stderr)

    if errors:
        raise SystemExit(1)

    time.sleep(3)
    verify_api(api, names)
    print(f"\n==> 验收通过，总耗时 {time.perf_counter() - t_all:.1f}s")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.TimeoutExpired as e:
        print(f"FAIL: 命令超时 ({e})", file=sys.stderr)
        raise SystemExit(1)
    except Exception as e:
        print(f"FAIL: {e}", file=sys.stderr)
        raise SystemExit(1)
