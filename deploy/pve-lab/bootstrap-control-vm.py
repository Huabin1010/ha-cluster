#!/usr/bin/env python3
"""VM 113 已创建并启动后：装 Docker、写入 control-vm.status.json"""
from __future__ import annotations

import json
import subprocess
import sys
import textwrap
import time
from pathlib import Path

LAB = Path(__file__).resolve().parent
PVE = "192.168.1.8"
VMID = 113


def ssh(cmd: str, timeout: int = 1200) -> tuple[int, str]:
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", f"root@{PVE}", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def guest(body: str, timeout: int = 1200) -> tuple[int, str]:
    inner = body.replace("'", "'\"'\"'")
    return ssh(f"qm guest exec {VMID} --timeout {timeout} -- bash -lc '{inner}'", timeout + 60)


def main() -> int:
    print("==> wait guest agent")
    for _ in range(48):
        c, o = ssh(f"qm guest cmd {VMID} ping 2>/dev/null && echo ok")
        if c == 0 and "ok" in o:
            break
        time.sleep(10)
    else:
        sys.exit("guest agent timeout")

    bootstrap = textwrap.dedent(
        """
        set -euo pipefail
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y -qq curl ca-certificates qemu-guest-agent
        systemctl enable --now qemu-guest-agent
        CODENAME=noble
        URI=https://mirrors.tuna.tsinghua.edu.cn/ubuntu
        mv /etc/apt/sources.list /etc/apt/sources.list.bak.ha 2>/dev/null || true
        rm -f /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true
        cat >/etc/apt/sources.list.d/ubuntu-tuna.sources <<EOF
Types: deb
URIs: ${URI}
Suites: ${CODENAME} ${CODENAME}-updates ${CODENAME}-backports ${CODENAME}-security
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
    c, o = guest(bootstrap, timeout=1200)
    print(o[-3000:])
    if c != 0 or "bootstrap_ok" not in o:
        sys.exit("bootstrap failed")

    c, o = guest(r"ip -4 -o addr show scope global dev eth0 | awk '{print $4}' | cut -d/ -f1", timeout=60)
    lan = ""
    import re

    for m in re.finditer(r"192\.168\.\d+\.\d+", o):
        lan = m.group(0)
        break
    if not lan:
        sys.exit(f"cannot detect LAN IP: {o}")

    meta = {"vmid": VMID, "name": "ha-control-lab", "lan_ip": lan, "fabric_ip": "10.129.129.1"}
    (LAB / "control-vm.status.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"==> ha-control-lab LAN={lan}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
