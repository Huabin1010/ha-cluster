#!/usr/bin/env python3
"""在 PVE 测试 VM 上执行命令（qm guest exec）。供 bootstrap / E2E 脚本复用。"""
from __future__ import annotations

import json
import re
import subprocess
import sys

PVE_HOST = "192.168.1.8"
NODE_VMID = {
    "ha-test-01": "110",
    "ha-test-02": "111",
    "ha-test-03": "112",
}


def workspace_inst_name(ws_id: str) -> str:
    """与 Go workspace.instName 一致：ha-<uuid 前 8 字符，无连字符>。"""
    return "ha-" + ws_id.replace("-", "")[:8]


def guest(vmid: str, script: str, pve: str = PVE_HOST, timeout: int = 600) -> tuple[int, str]:
    """在 VM 内执行 bash 脚本，返回 (exitcode, stdout+stderr)。

    必须把 timeout 传给 `qm guest exec`：PVE 默认 30s，超时只返回 pid、stdout 为空。
    """
    inner = script.replace("'", "'\"'\"'")
    qm_timeout = max(int(timeout), 30)
    remote = f"qm guest exec {vmid} --timeout {qm_timeout} -- bash -lc '{inner}'"
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", f"root@{pve}", remote],
        capture_output=True,
        text=True,
        timeout=qm_timeout + 30,
    )
    out = (r.stdout or "") + (r.stderr or "")
    m = re.search(r'"exitcode"\s*:\s*(\d+)', out)
    code = int(m.group(1)) if m else r.returncode
    try:
        j = json.loads(r.stdout)
        data = (j.get("out-data") or "") + (j.get("err-data") or "")
    except json.JSONDecodeError:
        data = out
    return code, data


def guest_node(node_name: str, script: str, **kwargs) -> tuple[int, str]:
    vmid = NODE_VMID.get(node_name)
    if not vmid:
        raise KeyError(f"unknown node {node_name}")
    return guest(vmid, script, **kwargs)


def main() -> int:
    vmid = sys.argv[1] if len(sys.argv) > 1 else "110"
    script = sys.argv[2] if len(sys.argv) > 2 else "incus list --format csv"
    code, data = guest(vmid, script)
    print(data, end="" if data.endswith("\n") else "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
