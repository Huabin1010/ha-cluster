#!/usr/bin/env python3
"""在 Worker 上开临时 Incus 工作区，验证嵌套 Docker 走 fuse-overlayfs。

默认生产工人 115。不改 cos/todo。

  python deploy/pve-lab/test-fuse-overlay.py
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAB = Path(__file__).resolve().parent
DEBS = ROOT / "packaging" / "cache" / "amd64" / "workspace-debs"
SSH_OPTS = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=NUL",
]


def run(cmd: list[str], timeout: int = 120) -> None:
    cp = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if cp.returncode != 0:
        raise RuntimeError((cp.stdout or "") + (cp.stderr or ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.1.89")
    ap.add_argument("--user", default="ubuntu")
    args = ap.parse_args()
    dest = f"{args.user}@{args.host}"

    fuse = list(DEBS.glob("fuse-overlayfs_*.deb"))
    debs = sorted(DEBS.glob("*.deb"))
    if not fuse:
        print(f"FAIL: missing fuse-overlayfs deb in {DEBS}", file=sys.stderr)
        print("  run: bash packaging/fetch-workspace-docker.sh amd64", file=sys.stderr)
        return 1

    fuse_debs = [
        p
        for p in debs
        if p.name.startswith(("fuse-overlayfs_", "libfuse", "fuse3_"))
    ]
    print(f"==> copy {len(fuse_debs)} fuse debs + probe script to {args.host}")
    run(["ssh", *SSH_OPTS, dest, "mkdir -p /tmp/ha-fuse-debs && sudo -n mkdir -p /var/lib/ha-cluster/workspace-debs"])
    run(["scp", *SSH_OPTS, *[str(p) for p in fuse_debs], f"{dest}:/tmp/ha-fuse-debs/"], timeout=120)
    run(["scp", *SSH_OPTS, str(LAB / "probe-fuse-overlay.sh"), f"{dest}:/tmp/probe-fuse-overlay.sh"])
    run(["ssh", *SSH_OPTS, dest, "sudo -n cp -af /tmp/ha-fuse-debs/*.deb /var/lib/ha-cluster/workspace-debs/"])

    print("==> launch probe workspace, install fuse-overlayfs, pull alpine")
    cp = subprocess.run(
        ["ssh", *SSH_OPTS, dest, "bash /tmp/probe-fuse-overlay.sh"],
        capture_output=True,
        text=True,
        timeout=420,
    )
    out = (cp.stdout or "") + (cp.stderr or "")
    print(out[-5000:])
    if cp.returncode != 0 or "TEST_DONE" not in out:
        print("FAIL: probe did not finish", file=sys.stderr)
        return 1
    if "DRIVER=fuse-overlayfs" not in out:
        print("FAIL: docker driver is not fuse-overlayfs", file=sys.stderr)
        return 1
    print("==> PASS nested Docker uses fuse-overlayfs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
