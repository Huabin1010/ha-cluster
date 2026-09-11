#!/usr/bin/env python3
"""模拟三台 worker 心跳，供纯 Docker 本地栈联调（无需 PVE agent）。"""
import json
import os
import time
import urllib.error
import urllib.request

BASE = os.environ.get("HA_API_BASE", "http://api:8080").rstrip("/")
TOKEN = os.environ.get("HA_NODE_TOKEN", "ha-test-node-token-2026")
INTERVAL = int(os.environ.get("HA_MOCK_AGENT_INTERVAL", "15"))

NODES = [
    ("ha-test-01", "10.129.129.205"),
    ("ha-test-02", "10.129.129.206"),
    ("ha-test-03", "10.129.129.207"),
]


def heartbeat(name: str, fabric_ip: str) -> None:
    body = {
        "name": name,
        "arch": "amd64",
        "role": "worker",
        "class": "desktop",
        "power": "mains",
        "fabric_ip": fabric_ip,
        "allocatable_cpu_milli": 4000,
        "allocatable_mem_bytes": 4 * 1024**3,
        "allocatable_disk_bytes": 32 * 1024**3,
        "cpu_usage_pct": 8.0,
        "mem_total_bytes": 4 * 1024**3,
        "disk_total_bytes": 40 * 1024**3,
        "mem_available_bytes": 3 * 1024**3,
        "disk_free_bytes": 28 * 1024**3,
        "fabric_path": "mock",
        "fabric_rtt_ms": 1,
    }
    req = urllib.request.Request(
        f"{BASE}/nodes/heartbeat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-HA-Node-Token": TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status != 200:
            raise RuntimeError(f"{name}: HTTP {resp.status}")


def main() -> None:
    print(f"mock-agents → {BASE} every {INTERVAL}s", flush=True)
    while True:
        for name, ip in NODES:
            try:
                heartbeat(name, ip)
                print(f"  heartbeat ok {name} ({ip})", flush=True)
            except (urllib.error.URLError, RuntimeError) as e:
                print(f"  heartbeat fail {name}: {e}", flush=True)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
