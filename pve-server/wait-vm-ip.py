#!/usr/bin/env python3
"""Poll PVE guest agent for VM IPv4 addresses."""
import json
import subprocess
import sys
import time

PVE = "root@192.168.1.8"


def vm_ip(vmid: int, retries: int = 30, delay: int = 5) -> str | None:
    for _ in range(retries):
        try:
            raw = subprocess.check_output(
                ["ssh", "-o", "BatchMode=yes", PVE, f"qm guest cmd {vmid} network-get-interfaces"],
                text=True,
                timeout=20,
            )
            data = json.loads(raw)
            for iface in data:
                for addr in iface.get("ip-addresses", []):
                    ip = addr.get("ip-address", "")
                    if addr.get("ip-address-type") == "ipv4" and ip.startswith("192.168."):
                        return ip
        except Exception:
            pass
        time.sleep(delay)
    return None


def main() -> int:
    vmids = [int(x) for x in sys.argv[1:]]
    result = {}
    for vmid in vmids:
        ip = vm_ip(vmid)
        result[vmid] = ip
        print(f"VM {vmid}: {ip or 'NOT READY'}")
    return 0 if all(result.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
