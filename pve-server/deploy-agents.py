#!/usr/bin/env python3
"""Deploy ha-agent to PVE test VMs and register with ha-api."""
import os
import sys
import time

import paramiko

API_BASE = os.environ.get("HA_API_BASE", "http://192.168.1.100:8080")
NODE_TOKEN = os.environ.get("HA_NODE_TOKEN", "ha-test-node-token-2026")
SSH_USER = "root"
KEY = os.path.expanduser("~/.ssh/id_rsa")
AGENT_BIN = os.path.join(os.path.dirname(__file__), "..", "tmp", "ha-agent-linux-amd64")

VMS = [
    ("192.168.1.84", "ha-test-01"),
    ("192.168.1.85", "ha-test-02"),
    ("192.168.1.87", "ha-test-03"),
]

SERVICE = """[Unit]
Description=ha-cluster worker agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
Environment=HA_API={api}
Environment=HA_NODE_TOKEN={token}
Environment=HA_FABRIC_IP={fabric}
ExecStart=/usr/local/bin/ha-agent \\
  -api {api} \\
  -name {name} \\
  -fabric-ip {fabric} \\
  -class desktop \\
  -power mains \\
  -cpu-milli 4000 \\
  -mem-bytes 3221225472 \\
  -disk-bytes 26843545600 \\
  -token {token} \\
  -listen :9091 \\
  -interval 15s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
"""


def deploy(ip: str, name: str, fabric: str) -> bool:
    print(f"\n=== deploy {name} @ {ip} ===")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(ip, username=SSH_USER, key_filename=KEY, timeout=10)
    sftp = client.open_sftp()
    sftp.put(AGENT_BIN, "/usr/local/bin/ha-agent")
    sftp.chmod("/usr/local/bin/ha-agent", 0o755)
    unit = SERVICE.format(api=API_BASE, token=NODE_TOKEN, fabric=fabric, name=name)
    with sftp.file("/etc/systemd/system/ha-agent.service", "w") as f:
        f.write(unit)
    sftp.close()
    cmds = [
        "systemctl daemon-reload",
        "systemctl enable --now ha-agent",
        "sleep 2",
        "systemctl is-active ha-agent",
        f"/usr/local/bin/ha-agent -api {API_BASE} -name {name} -fabric-ip {fabric} -token {NODE_TOKEN} -once",
    ]
    for cmd in cmds:
        _, stdout, stderr = client.exec_command(cmd, timeout=60)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        if out:
            print(f"  {cmd}: {out}")
        if err and "Warning" not in err:
            print(f"  stderr: {err[:200]}")
    client.close()
    return True


def main() -> int:
    if not os.path.isfile(AGENT_BIN):
        print(f"missing binary: {AGENT_BIN}")
        return 1
    for ip, name in VMS:
        deploy(ip, name, ip)
    print("\nWaiting 5s for heartbeats...")
    time.sleep(5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
