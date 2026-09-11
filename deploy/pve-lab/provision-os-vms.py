#!/usr/bin/env python3
"""
在 PVE 宿主机上从清华源下载 Ubuntu 22.04 / 24.04 / 26.04 cloud 镜像并创建测试 VM。

  python deploy/pve-lab/provision-os-vms.py              # 三台全部
  python deploy/pve-lab/provision-os-vms.py --only jammy
  python deploy/pve-lab/provision-os-vms.py --dry-run

VM 110=jammy, 111=noble, 112=resolute（见 os-images.json）。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import textwrap
import time
from pathlib import Path

LAB = Path(__file__).resolve().parent
SPECS = json.loads((LAB / "os-images.json").read_text(encoding="utf-8"))
PVE = "192.168.1.8"
# 机械盘 data-backup（sdb1 1.8T）；SSD local-lvm 已 99% 满
IMAGE_DIR = "/mnt/pve/data-backup/ha-cluster/pve-images"
BRIDGE = "vmbr0"
STORAGE = "data-backup"
MEMORY = 4096
CORES = 2
DISK_GB = 32
CI_PASSWORD = "HaTest2026!"
SNIPPET = "/mnt/pve/data-backup/snippets/ha-worker-ci.yaml"
SNIPPET_REF = "data-backup:snippets/ha-worker-ci.yaml"


def ssh(cmd: str, timeout: int = 7200) -> tuple[int, str]:
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", f"root@{PVE}", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    out = (r.stdout or "") + (r.stderr or "")
    return r.returncode, out


def remote_script(body: str, timeout: int = 7200) -> tuple[int, str]:
    escaped = body.replace("'", "'\"'\"'")
    return ssh(f"bash -lc '{escaped}'", timeout=timeout)


def ensure_cloudinit_snippet() -> None:
    body = textwrap.dedent(
        f"""
        mkdir -p /mnt/pve/data-backup/snippets
        cat >'{SNIPPET}' <<'EOF'
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


def provision_one(spec: dict, dry_run: bool) -> None:
    vmid = spec["vmid"]
    name = spec["name"]
    img = spec["image"]
    url = spec.get("mirror_url") or spec["download_url"]
    fallback = spec["download_url"]
    codename = spec["codename"]
    remote_img = f"{IMAGE_DIR}/{img}"

    script = textwrap.dedent(
        f"""
        set -euo pipefail
        VMID={vmid}
        NAME='{name}'
        IMG='{remote_img}'
        URL='{url}'
        FALLBACK='{fallback}'
        CODENAME='{codename}'
        mkdir -p '{IMAGE_DIR}'
        if [[ ! -f "$IMG" ]]; then
          echo "==> download $URL"
          if ! curl -fL --retry 3 --connect-timeout 30 --max-time 0 -o "$IMG.partial" "$URL"; then
            echo "==> mirror failed, fallback $FALLBACK"
            curl -fL --retry 3 --connect-timeout 30 --max-time 0 -o "$IMG.partial" "$FALLBACK"
          fi
          mv "$IMG.partial" "$IMG"
        else
          echo "==> reuse $IMG"
        fi
        if qm status "$VMID" &>/dev/null; then
          echo "==> destroy existing VM $VMID"
          qm stop "$VMID" 2>/dev/null || true
          sleep 2
          qm destroy "$VMID" --purge
        fi
        echo "==> create VM $VMID ($NAME / $CODENAME)"
        qm create "$VMID" --name "$NAME" --memory {MEMORY} --cores {CORES} --net0 virtio,bridge={BRIDGE}
        qm importdisk "$VMID" "$IMG" {STORAGE}
        qm set "$VMID" --scsihw virtio-scsi-pci --scsi0 {STORAGE}:vm-${{VMID}}-disk-0
        qm set "$VMID" --ide2 {STORAGE}:cloudinit
        qm set "$VMID" --boot order=scsi0 --serial0 socket --vga serial0
        qm set "$VMID" --agent enabled=1
        qm set "$VMID" --ipconfig0 ip=dhcp
        qm set "$VMID" --ciuser ubuntu --citype nocloud --cipassword '{CI_PASSWORD}'
        qm set "$VMID" --cicustom 'user={SNIPPET_REF}'
        qm resize "$VMID" scsi0 {DISK_GB}G
        qm cloudinit update "$VMID"
        qm start "$VMID"
        echo "==> started $VMID"
        """
    ).strip()

    if dry_run:
        print(f"--- dry-run {name} (VM {vmid}) ---\n{script}\n")
        return

    ensure_cloudinit_snippet()
    code, out = remote_script(script, timeout=7200)
    print(out)
    if code != 0:
        raise RuntimeError(f"provision {name} failed: {out[-500:]}")

    print(f"==> wait guest agent on {vmid}")
    for i in range(48):
        c, o = ssh(f"qm guest cmd {vmid} ping 2>/dev/null && echo ok")
        if c == 0 and "ok" in o:
            break
        time.sleep(10)
    else:
        raise RuntimeError(f"guest agent timeout on {vmid} (check cloud-init / qemu-guest-agent)")

    # 首启：清华源 + qemu-guest-agent
    mirror_body = textwrap.dedent(
        f"""
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq || true
        apt-get install -y -qq curl ca-certificates qemu-guest-agent
        systemctl enable --now qemu-guest-agent
        CODENAME='{codename}'
        ARCH=amd64
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
        echo mirror_ok
        """
    ).strip()
    inner = mirror_body.replace("'", "'\"'\"'")
    c, o = ssh(
        f"qm guest exec {vmid} --timeout 600 -- bash -lc '{inner}'",
        timeout=660,
    )
    print(o[-2000:])
    if c != 0 or "mirror_ok" not in o:
        raise RuntimeError(f"mirror bootstrap failed on {vmid}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=list(SPECS.keys()), action="append", help="jammy|noble|resolute")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    keys = args.only or list(SPECS.keys())
    t0 = time.perf_counter()
    for key in keys:
        print(f"\n######## {key} ########")
        provision_one(SPECS[key], args.dry_run)

    # 写回 nodes.json 供 bootstrap 使用
    if not args.dry_run:
        nodes = []
        for key in SPECS:
            s = SPECS[key]
            nodes.append(
                {
                    "vmid": s["vmid"],
                    "name": s["name"],
                    "fabric_ip": s["fabric_ip"],
                    "ubuntu": s["series"],
                    "codename": s["codename"],
                }
            )
        (LAB / "nodes.json").write_text(json.dumps(nodes, indent=2) + "\n", encoding="utf-8")
        print(f"\n==> updated {LAB / 'nodes.json'}")

    print(f"\n==> done in {time.perf_counter() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"FAIL: {e}", file=sys.stderr)
        raise SystemExit(1)
