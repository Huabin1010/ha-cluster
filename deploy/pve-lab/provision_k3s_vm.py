#!/usr/bin/env python3
"""在 PVE 上从模板 100 克隆一台空 Worker，用于离线 k3s 真机验收。

  python deploy/pve-lab/provision_k3s_vm.py
  python deploy/pve-lab/provision_k3s_vm.py --recreate

PVE 只跑 qm；安装包一律从局域网 Depot 拉。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time

PVE = "192.168.1.8"
TEMPLATE = 100
VMID = 116
NAME = "ha-k3s-lab"
FABRIC_IP = "10.129.129.208"
CORES = 4
MEMORY = 4096


def ssh(cmd: str, timeout: int = 120) -> tuple[int, str]:
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", f"root@{PVE}", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def vm_exists() -> bool:
    code, _ = ssh(f"qm status {VMID} >/dev/null 2>&1")
    return code == 0


def wait_guest(timeout: int = 300) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        code, out = ssh(f"qm guest cmd {VMID} ping 2>/dev/null && echo ok")
        if code == 0 and "ok" in out:
            return
        time.sleep(5)
    raise RuntimeError(f"guest agent timeout on {VMID}")


def grow_root() -> None:
    ssh(
        f"qm guest exec {VMID} --timeout 120 -- bash -lc "
        f"'lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv 2>/dev/null || true; "
        f"resize2fs /dev/ubuntu-vg/ubuntu-lv 2>/dev/null || true'"
    )


def provision(
    recreate: bool,
    vmid: int | None = None,
    name: str | None = None,
    fabric_ip: str | None = None,
    cores: int | None = None,
    memory: int | None = None,
) -> None:
    global VMID, NAME, FABRIC_IP, CORES, MEMORY
    if vmid is not None:
        VMID = vmid
    if name is not None:
        NAME = name
    if fabric_ip is not None:
        FABRIC_IP = fabric_ip
    if cores is not None:
        CORES = cores
    if memory is not None:
        MEMORY = memory
    if vm_exists():
        if not recreate:
            print(f"==> reuse VM {VMID} ({NAME})")
            ssh(f"qm start {VMID} >/dev/null 2>&1 || true")
            wait_guest()
            grow_root()
            return
        print(f"==> destroy existing VM {VMID}")
        ssh(f"qm stop {VMID} --timeout 30 >/dev/null 2>&1 || true")
        time.sleep(2)
        code, out = ssh(f"qm destroy {VMID} --purge", timeout=180)
        if code != 0:
            raise RuntimeError(f"destroy {VMID} failed: {out[-400:]}")

    print(f"==> clone {TEMPLATE} → {VMID} {NAME}")
    code, out = ssh(
        f"qm clone {TEMPLATE} {VMID} --name {NAME} --full 0 && "
        f"qm set {VMID} --cores {CORES} --memory {MEMORY} --cpu host --agent enabled=1 && "
        f"qm start {VMID}",
        timeout=300,
    )
    if code != 0:
        raise RuntimeError(f"clone/start failed: {out[-500:]}")
    print("==> wait qemu-guest-agent")
    wait_guest()
    ssh(
        f"qm guest exec {VMID} --timeout 60 -- bash -lc "
        f"'hostnamectl set-hostname {NAME}; echo {NAME} > /etc/hostname'"
    )
    grow_root()
    print(f"==> VM {VMID} ready")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--recreate", action="store_true")
    ap.add_argument("--vmid", type=int)
    ap.add_argument("--name")
    ap.add_argument("--fabric-ip")
    ap.add_argument("--cores", type=int)
    ap.add_argument("--memory", type=int)
    args = ap.parse_args()
    global VMID, NAME, FABRIC_IP, CORES, MEMORY
    provision(
        args.recreate,
        vmid=args.vmid,
        name=args.name,
        fabric_ip=args.fabric_ip,
        cores=args.cores,
        memory=args.memory,
    )
    print(json.dumps({"vmid": VMID, "name": NAME, "fabric_ip": FABRIC_IP}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
