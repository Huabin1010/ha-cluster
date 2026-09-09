#!/usr/bin/env python3
"""Add SSH pubkey and set hostname on ha-test VMs."""
import os
import sys

import paramiko

PUBKEY = (
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDeti0v2hsgCzBW9NyUPYYis8PLq/R8kWZtyUIs8Tm28muECQjH6eRSr6CFPvN/YKyQzgoiylyxoudeIpzj/Aob0JlNJJtppgFw5336Pg/c9aZqmwVEaUKpvHo6txMpb80nBJPnellLFkWrcaoK9zEAp877QbuwZuTgNhOPPDF/9qOojS6ewnfe2Jfnpwn2bOHLG644fARjTvVsYWhww6B41BNt+ZWlkvYZVld3jPDp9Q7enxt6u4sRf8CWvJgmra5TVkjOKWhl4JcZk2GrfhGgJRv5s3H2UiRro5phwdUyYJNBZ5/rC7AaCZuzqgezTrXGnryvZoi/r9Dcxu+sY22V6yuiHuZwBqWseRAVEOtRPD7aOk+FxiYBITfGc5+CYwDLfS65z4t7Bo19nZuI6rPs8KPX7nDvLcOTLafIM5Rat4QKBLTXw+skfe4QcEPgfV8UsiON/DwNnTRT3S+bouFSLATBr/lek6XkrOTpD7A2Q82RE+OCV16FoeI2rd+qvOa7xfTiJ2Ukwj064WdUc5XuajNYPVblmKT6rG1+44/xs2ru3n28NSr31DNp/Rj6LJE/mFyb+9FyoY+vbdXk7ZSH2nbYcJ4Ty4iyadGxPeE7gOEnN9MBjEUOE8CR/U/jEBcKBIRP64aTlSsG25mwkFEtceJGDLVpUURUdCuawgWnhQ== 10101@DESKTOP-RFHF2JD"
)
USER = "shuangyuan"
PASSWORD = "123456qq"

VMS = [
    ("192.168.1.84", "ha-test-01"),
    ("192.168.1.85", "ha-test-02"),
    ("192.168.1.87", "ha-test-03"),
]

SETUP_SH = """#!/bin/bash
set -e
HOSTNAME='__HOSTNAME__'
PUBKEY='__PUBKEY__'
hostnamectl set-hostname "$HOSTNAME"
echo "$HOSTNAME" > /etc/hostname
for u in root shuangyuan; do
  home=$(eval echo ~$u)
  mkdir -p "$home/.ssh"
  touch "$home/.ssh/authorized_keys"
  grep -qF "$PUBKEY" "$home/.ssh/authorized_keys" || echo "$PUBKEY" >> "$home/.ssh/authorized_keys"
  chmod 700 "$home/.ssh"
  chmod 600 "$home/.ssh/authorized_keys"
  [ "$u" = shuangyuan ] && chown -R shuangyuan:shuangyuan "$home/.ssh"
done
echo 'shuangyuan ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/shuangyuan
chmod 440 /etc/sudoers.d/shuangyuan
if grep -q '^#*PermitRootLogin' /etc/ssh/sshd_config; then
  sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
fi
systemctl restart ssh
echo OK $(hostname) $(hostname -I | cut -d' ' -f1)
"""


def setup(ip: str, hostname: str) -> bool:
    print(f"\n--- {hostname} @ {ip} ---")
    script = SETUP_SH.replace("__HOSTNAME__", hostname).replace("__PUBKEY__", PUBKEY)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(ip, username=USER, password=PASSWORD, timeout=10)
    sftp = client.open_sftp()
    with sftp.file("/tmp/ha-setup.sh", "w") as f:
        f.write(script)
    sftp.chmod("/tmp/ha-setup.sh", 0o700)
    sftp.close()
    _, stdout, stderr = client.exec_command(
        f"echo {PASSWORD} | sudo -S /tmp/ha-setup.sh", timeout=30
    )
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    code = stdout.channel.recv_exit_status()
    client.close()
    print(out)
    if err and "password" not in err.lower():
        print("stderr:", err[:200])
    return code == 0 and out.startswith("OK")


def verify_key(ip: str, user: str) -> bool:
    key = paramiko.RSAKey.from_private_key_file(os.path.expanduser("~/.ssh/id_rsa"))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(ip, username=user, pkey=key, timeout=10)
        _, stdout, _ = client.exec_command("whoami; hostname")
        print(f"  key {user}@{ip}: {stdout.read().decode().strip()}")
        client.close()
        return True
    except Exception as exc:
        print(f"  key {user}@{ip} FAILED: {exc}")
        return False


def main() -> int:
    ok = sum(1 for ip, host in VMS if setup(ip, host))
    print("\n=== verify ===")
    for ip, _ in VMS:
        verify_key(ip, "shuangyuan")
        verify_key(ip, "root")
    print(f"\nDone: {ok}/{len(VMS)}")
    return 0 if ok == len(VMS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
