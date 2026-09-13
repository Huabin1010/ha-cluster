#!/usr/bin/env python3
"""把实验室/生产 Worker VM 的 QEMU CPU 设为 host（透传 AVX2）。

  python deploy/pve-lab/ensure-cpu-host.py
  python deploy/pve-lab/ensure-cpu-host.py --skip-reboot 115

已是 host 且客机已有 avx2 的跳过重启。改 cpu 必须停机再开，客机 reboot 不够。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

PVE = "192.168.1.8"
# 100 模板只改配置不启动；其余按顺序重启（115 生产最后）
VMIDS = (100, 110, 111, 112, 113, 114, 116, 115)
TEMPLATE = 100


def ssh(cmd: str, timeout: int = 120) -> tuple[int, str]:
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", f"root@{PVE}", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()


def qm_cpu(vmid: int) -> str:
    _, out = ssh(f"qm config {vmid} | grep -E '^cpu:' || true")
    return out.replace("cpu:", "").strip() or "(default kvm64)"


def qm_status(vmid: int) -> str:
    _, out = ssh(f"qm status {vmid} | awk '{{print $2}}'")
    return out.strip()


def wait_stopped(vmid: int, timeout: int = 120) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if qm_status(vmid) == "stopped":
            return
        time.sleep(2)
    ssh(f"qm stop {vmid}")
    time.sleep(2)


def wait_guest(vmid: int, timeout: int = 240) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        code, out = ssh(f"qm guest cmd {vmid} ping 2>/dev/null && echo ok")
        if code == 0 and "ok" in out:
            return True
        time.sleep(4)
    return False


def guest_has_avx2(vmid: int) -> bool:
    code, out = ssh(
        f"qm guest exec {vmid} --timeout 30 -- bash -lc "
        f"'grep -qw avx2 /proc/cpuinfo && echo HAS_AVX2 || echo NO_AVX2'",
        timeout=45,
    )
    return "HAS_AVX2" in out and code == 0


def reboot_apply(vmid: int) -> None:
    print(f"    shutdown {vmid}")
    ssh(f"qm shutdown {vmid} --timeout 90 || true")
    wait_stopped(vmid)
    print(f"    start {vmid}")
    code, out = ssh(f"qm start {vmid}")
    if code != 0:
        raise RuntimeError(f"start {vmid} failed: {out[-400:]}")
    if not wait_guest(vmid):
        print(f"    warn: guest agent not up on {vmid}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-reboot", type=int, action="append", default=[], help="VMID 只改配置不重启")
    args = ap.parse_args()
    skip = set(args.skip_reboot)

    for vmid in VMIDS:
        st = qm_status(vmid)
        cpu = qm_cpu(vmid)
        print(f"==> {vmid} status={st} cpu={cpu}")
        code, out = ssh(f"qm set {vmid} --cpu host")
        if code != 0:
            print(f"    FAIL set cpu: {out}", file=sys.stderr)
            return 1
        print(f"    set cpu=host")
        if vmid == TEMPLATE:
            print("    skip reboot (template)")
            continue
        if vmid in skip:
            print("    skip reboot (--skip-reboot)")
            continue
        if st != "running":
            print("    not running, start")
            ssh(f"qm start {vmid}")
            wait_guest(vmid)
        elif cpu == "host" and wait_guest(vmid, timeout=20) and guest_has_avx2(vmid):
            print("    already host+avx2, skip reboot")
            continue
        else:
            reboot_apply(vmid)
        if wait_guest(vmid, timeout=30) and guest_has_avx2(vmid):
            print("    OK avx2")
        else:
            print("    warn: avx2 not confirmed via guest-agent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
