#!/usr/bin/env python3
"""
PVE 测试 Worker 一键安装（默认 PVE 局域网镜像，约 1 分钟内完成三台）。

  python deploy/pve-lab/pack.py              # 仅打包
  python deploy/pve-lab/upload.py            # 上传 Depot（发布用，不必每次跑）
  python deploy/pve-lab/bootstrap.py         # 同步到 PVE + 并行安装 + 验收

选项：
  --skip-sync    跳过 scp（PVE 上已有 /tmp/ha-pve-lab-staging）
  --skip-reset   不重置，仅覆盖安装
  --depot-only   不用局域网镜像，走公网 Depot（较慢）
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAB = Path(__file__).resolve().parent
DIST = ROOT / "dist" / "pve-lab"
GUEST_TIMEOUT = 120  # 单台 agent 安装通常 < 30s


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        sys.exit(f"missing {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"')
    return out


def run(cmd: list[str], timeout: int = 120) -> None:
    print("+", " ".join(cmd[:6]), ("..." if len(cmd) > 6 else ""))
    cp = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if cp.returncode != 0:
        raise RuntimeError((cp.stderr or cp.stdout or "command failed").strip())


def guest_exec(env: dict[str, str], vmid: int, bash_body: str) -> tuple[int, str, float]:
    host = env.get("PVE_HOST", "192.168.1.8")
    user = env.get("PVE_USER", "root")
    inner = bash_body.replace("'", "'\"'\"'")
    remote = f"qm guest exec {vmid} -- bash -lc '{inner}'"
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


def mirror_url(env: dict[str, str]) -> str:
    host = env.get("PVE_HOST", "192.168.1.8")
    port = env.get("PVE_MIRROR_PORT", "19090")
    return f"http://{host}:{port}"


def mirror_alive(env: dict[str, str]) -> bool:
    host = env.get("PVE_HOST", "192.168.1.8")
    user = env.get("PVE_USER", "root")
    port = env.get("PVE_MIRROR_PORT", "19090")
    cp = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            f"{user}@{host}",
            f"curl -sf -o /dev/null http://127.0.0.1:{port}/install.sh",
        ],
        capture_output=True,
        timeout=8,
    )
    return cp.returncode == 0


def sync_pve_mirror(env: dict[str, str]) -> str:
    """开发机 → PVE：单个 tar 上传（~3s），VM 走局域网拉包。"""
    host = env.get("PVE_HOST", "192.168.1.8")
    user = env.get("PVE_USER", "root")
    port = env.get("PVE_MIRROR_PORT", "19090")
    remote = "/tmp/ha-pve-lab-staging"
    tarball = DIST.parent / "pve-lab-bundle.tar"

    if not DIST.is_dir():
        subprocess.run([sys.executable, str(LAB / "pack.py")], cwd=ROOT, check=True)

    with tarfile.open(tarball, "w") as tar:
        for f in sorted(DIST.iterdir()):
            if f.is_file():
                tar.add(f, arcname=f.name)

    run(["scp", "-o", "BatchMode=yes", str(tarball), f"{user}@{host}:/tmp/pve-lab-bundle.tar"], timeout=60)
    run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            f"{user}@{host}",
            f"mkdir -p {remote} && tar xf /tmp/pve-lab-bundle.tar -C {remote} "
            f"&& sed -i 's/\\r$//' {remote}/*.sh {remote}/*.env 2>/dev/null || true",
        ],
        timeout=30,
    )
    subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            f"{user}@{host}",
            "systemctl stop ha-pve-lab-http 2>/dev/null || true; "
            f"systemd-run --unit=ha-pve-lab-http --collect "
            f"/usr/bin/python3 -m http.server {port} --bind 0.0.0.0 --directory {remote}",
        ],
        check=False,
        timeout=15,
    )
    time.sleep(0.5)
    base = mirror_url(env)
    if not mirror_alive(env):
        raise RuntimeError(f"mirror check failed: {base}/install.sh")
    return base


def install_one(env: dict[str, str], node: dict, staging: str, skip_reset: bool) -> tuple[str, float, str]:
    vmid, name, fabric = node["vmid"], node["name"], node["fabric_ip"]
    api = env.get("HA_API_BASE", "http://192.168.1.100:8080")
    token = env.get("HA_NODE_TOKEN", "ha-test-node-token-2026")
    skip_incus = env.get("SKIP_INCUS", "1")
    skip_et = env.get("SKIP_EASYTIER", "1")

    if skip_reset:
        script = "install.sh"
        body = (
            f"export STAGING='{staging}' NODE_NAME='{name}' FABRIC_IP='{fabric}' "
            f"HA_API_BASE='{api}' HA_NODE_TOKEN='{token}' "
            f"SKIP_INCUS='{skip_incus}' SKIP_EASYTIER='{skip_et}'; "
            f"curl --connect-timeout 5 --max-time 30 -fsSL '{staging}/{script}' -o /tmp/ha-i.sh && bash /tmp/ha-i.sh"
        )
    else:
        body = (
            f"export STAGING='{staging}' NODE_NAME='{name}' FABRIC_IP='{fabric}' "
            f"HA_API_BASE='{api}' HA_NODE_TOKEN='{token}' "
            f"SKIP_INCUS='{skip_incus}' SKIP_EASYTIER='{skip_et}'; "
            f"curl --connect-timeout 5 --max-time 30 -fsSL '{staging}/reinstall.sh' -o /tmp/ha-r.sh && bash /tmp/ha-r.sh"
        )

    code, out, elapsed = guest_exec(env, vmid, body)
    if code != 0 or "==> done" not in out:
        raise RuntimeError(f"{name} failed in {elapsed:.1f}s: {out[-400:]}")
    return name, elapsed, out


def verify_api(api: str, names: list[str]) -> None:
    login = json.dumps({"username": "admin", "password": "adminadmin"}).encode()
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
    ap.add_argument("--skip-sync", action="store_true")
    ap.add_argument("--skip-reset", action="store_true")
    ap.add_argument("--depot-only", action="store_true", help="用公网 Depot，不用 PVE 局域网镜像")
    args = ap.parse_args()

    env = load_env(LAB / "lab.env")
    depot = env.get("DEPOT_PUBLIC", "https://rustfs.s.ggss.club:50000/typora/ha-cluster").rstrip("/")
    api = env.get("HA_API_BASE", "http://192.168.1.100:8080")
    nodes = json.loads((LAB / "nodes.json").read_text(encoding="utf-8"))
    names = [n["name"] for n in nodes]

    t_all = time.perf_counter()

    if args.depot_only:
        staging = f"{depot}/pve-lab"
        print(f"==> 使用公网 Depot: {staging}")
        try:
            urllib.request.urlopen(f"{staging}/install.sh", timeout=15)
        except urllib.error.URLError as e:
            sys.exit(f"Depot 不可达: {e}")
    elif args.skip_sync or mirror_alive(env):
        staging = mirror_url(env)
        print(f"==> 使用已有 PVE 镜像: {staging}")
    else:
        t0 = time.perf_counter()
        staging = sync_pve_mirror(env)
        print(f"==> PVE 镜像已同步 {staging} ({time.perf_counter() - t0:.1f}s)")

    print(f"==> 并行安装 {len(nodes)} 台 (timeout={GUEST_TIMEOUT}s/台)")
    errors: list[str] = []
    # qemu-guest-agent 并行 guest exec 易卡住，串行更稳（单台 ~20s，三台 ~1min）
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
