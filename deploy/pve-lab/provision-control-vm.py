#!/usr/bin/env python3
"""在 PVE 上创建专用控制面测试 VM（默认 113 / ha-control-lab），并安装 Docker。"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import textwrap
import time
from pathlib import Path

LAB = Path(__file__).resolve().parent
SPEC = json.loads((LAB / "control-vm.json").read_text(encoding="utf-8"))
PVE = "192.168.1.8"
IMAGE_DIR = "/mnt/pve/data-backup/ha-cluster/pve-images"
BRIDGE = "vmbr0"
STORAGE = "data-backup"
CI_PASSWORD = "HaTest2026!"
SNIPPET = "/mnt/pve/data-backup/snippets/ha-control-ci.yaml"
SNIPPET_REF = "data-backup:snippets/ha-control-ci.yaml"


def ssh(cmd: str, timeout: int = 7200) -> tuple[int, str]:
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", f"root@{PVE}", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    out = (r.stdout or "") + (r.stderr or "")
    return r.returncode, out


def guest(vmid: int, body: str, timeout: int = 1800) -> tuple[int, str]:
    inner = body.replace("'", "'\"'\"'")
    return ssh(f"qm guest exec {vmid} --timeout {timeout} -- bash -lc '{inner}'", timeout=timeout + 60)


def ensure_snippet() -> None:
    body = textwrap.dedent(
        """
        mkdir -p /mnt/pve/data-backup/snippets
        cat >'/mnt/pve/data-backup/snippets/ha-control-ci.yaml' <<'EOF'
#cloud-config
package_update: true
packages:
  - qemu-guest-agent
  - curl
  - ca-certificates
runcmd:
  - systemctl enable --now qemu-guest-agent
EOF
        """
    ).strip()
    ssh(body, timeout=60)


def provision(dry_run: bool) -> None:
    vmid = SPEC["vmid"]
    name = SPEC["name"]
    img_name = SPEC["image"]
    url = SPEC["download_url"]
    codename = SPEC["codename"]
    memory = SPEC.get("memory_mb", 8192)
    cores = SPEC.get("cores", 4)
    disk_gb = SPEC.get("disk_gb", 48)
    remote_img = f"{IMAGE_DIR}/{img_name}"

    script = textwrap.dedent(
        f"""
        set -euo pipefail
        VMID={vmid}
        NAME='{name}'
        IMG='{remote_img}'
        URL='{url}'
        mkdir -p '{IMAGE_DIR}'
        if [[ ! -f "$IMG" ]]; then
          curl -fL --retry 3 -o "$IMG.partial" "$URL"
          mv "$IMG.partial" "$IMG"
        fi
        if qm status "$VMID" &>/dev/null; then
          qm stop "$VMID" 2>/dev/null || true
          sleep 2
          qm destroy "$VMID" --purge
        fi
        qm create "$VMID" --name "$NAME" --memory {memory} --cores {cores} --net0 virtio,bridge={BRIDGE}
        qm importdisk "$VMID" "$IMG" {STORAGE}
        qm set "$VMID" --scsihw virtio-scsi-pci --scsi0 {STORAGE}:${{VMID}}/vm-${{VMID}}-disk-0.raw
        qm set "$VMID" --ide2 {STORAGE}:cloudinit
        qm set "$VMID" --boot order=scsi0 --serial0 socket --vga serial0
        qm set "$VMID" --agent enabled=1
        qm set "$VMID" --ipconfig0 ip=dhcp
        qm set "$VMID" --ciuser ubuntu --citype nocloud --cipassword '{CI_PASSWORD}'
        qm set "$VMID" --cicustom 'user={SNIPPET_REF}'
        qm resize "$VMID" scsi0 {disk_gb}G
        qm cloudinit update "$VMID"
        qm start "$VMID"
        echo started
        """
    ).strip()

    if dry_run:
        print(script)
        return

    ensure_snippet()
    escaped = script.replace("'", "'\"'\"'")
    code, out = ssh(f"bash -lc '{escaped}'")
    print(out)
    if code != 0:
        raise RuntimeError(out[-500:])

    print(f"==> wait guest agent on {vmid}")
    for _ in range(48):
        c, o = ssh(f"qm guest cmd {vmid} ping 2>/dev/null && echo ok")
        if c == 0 and "ok" in o:
            break
        time.sleep(10)
    else:
        raise RuntimeError("guest agent timeout")

    bootstrap = textwrap.dedent(
        f"""
        set -euo pipefail
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y -qq curl ca-certificates qemu-guest-agent
        systemctl enable --now qemu-guest-agent
        CODENAME='{codename}'
        URI=https://mirrors.tuna.tsinghua.edu.cn/ubuntu
        mv /etc/apt/sources.list /etc/apt/sources.list.bak.ha 2>/dev/null || true
        rm -f /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true
        cat >/etc/apt/sources.list.d/ubuntu-tuna.sources <<EOF
Types: deb
URIs: ${{URI}}
Suites: ${{CODENAME}} ${{CODENAME}}-updates ${{CODENAME}}-backports ${{CODENAME}}-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
        apt-get update -qq
        if ! command -v docker >/dev/null; then
          curl -fsSL https://get.docker.com | sh
          systemctl enable --now docker
        fi
        docker --version
        echo bootstrap_ok
        """
    ).strip()
    c, o = guest(vmid, bootstrap, timeout=1200)
    print(o[-3000:])
    if c != 0 or "bootstrap_ok" not in o:
        raise RuntimeError("docker bootstrap failed")

    ip_body = r"ip -4 -o addr show scope global dev eth0 | awk '{print $4}' | cut -d/ -f1"
    c, o = guest(vmid, ip_body, timeout=60)
    lan = ""
    for line in o.splitlines():
        line = line.strip().replace("\\n", "")
        if line.startswith("192.168."):
            lan = line
            break
    if not lan:
        raise RuntimeError(f"cannot detect LAN IP: {o}")

    meta = {"vmid": vmid, "name": name, "lan_ip": lan, "fabric_ip": SPEC["fabric_ip"]}
    (LAB / "control-vm.status.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"\n==> {name} ready  LAN={lan}  (VMID {vmid})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    provision(args.dry_run)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"FAIL: {e}", file=sys.stderr)
        raise SystemExit(1)
