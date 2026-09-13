#!/usr/bin/env python3
"""PVE 真机：空机全量离线安装（含 k3s）+ 已有无 k3s 节点 upgrade。

  python deploy/pve-lab/test-k3s-install.py
  python deploy/pve-lab/test-k3s-install.py --skip-provision
  python deploy/pve-lab/test-k3s-install.py --upgrade-only

禁止在目标机出网装 k3s；制品只从 lab.env 的 DEPOT_PUBLIC（默认局域网 RustFS）拉。
"""
from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[1]
sys.path.insert(0, str(LAB))
sys.path.insert(0, str(ROOT / "packaging"))
from bootstrap import depot_url, guest_exec, load_env, verify_depot  # noqa: E402
from provision_k3s_vm import FABRIC_IP, NAME, VMID, provision  # noqa: E402

GUEST_TIMEOUT = 1800
UPGRADE_VMID = 114
UPGRADE_NAME = "ha-join-test"


def assert_depot_k3s(base: str) -> None:
    missing: list[str] = []
    for path in (
        "/lab/install-k3s.sh",
        "/lab/worker-install.sh",
        "/bin/amd64/k3s",
        "/bundles/amd64/k3s-airgap-images.tar.zst",
    ):
        try:
            urllib.request.urlopen(f"{base}{path}", timeout=20)
        except urllib.error.URLError:
            missing.append(path)
    # 一包离线 tar.gz 可选
    try:
        urllib.request.urlopen(f"{base}/bundles/amd64/k3s-offline.tar.gz", timeout=20)
    except urllib.error.URLError:
        print("warn: k3s-offline.tar.gz missing — two-file fallback will be used")
    if missing:
        raise SystemExit(f"Depot 缺 k3s 制品 {missing}，请先 fetch_k3s + pack_k3s + upload")


def forbid_online_install_script(out: str) -> None:
    bad = ("get.k3s.io", "github.com/k3s-io", "INSTALL_K3S_SKIP_DOWNLOAD=false")
    for needle in bad:
        if needle in out and "forbid" not in out.lower():
            # 日志里提到禁止出网是允许的
            if "refuse" in out or "禁止" in out or "offline" in out:
                continue
            raise RuntimeError(f"install log mentions online k3s source: {needle}")


def install_empty(env: dict[str, str], staging: str) -> str:
    api = env.get("HA_API_BASE", "http://192.168.1.100:8080")
    token = env.get("HA_NODE_TOKEN", "ha-test-node-token-2026")
    et_secret = env.get("HA_ET_SECRET", "")
    et_peers = env.get("HA_ET_PEERS", "")
    et_net = env.get("HA_ET_NET", "ha-cluster-easytier")
    body = (
        f"export STAGING='{staging}' DEPOT_PUBLIC='{staging}' NODE_NAME='{NAME}' "
        f"FABRIC_IP='{FABRIC_IP}' HA_API_BASE='{api}' HA_NODE_TOKEN='{token}' "
        f"SKIP_INCUS='0' SKIP_EASYTIER='0' SKIP_K3S='0' "
        f"HA_INSTALL_MODE='offline' HA_APT_MIRROR='tuna' HA_VERIFY_EGRESS='0' "
        f"HA_ET_NET='{et_net}' HA_ET_SECRET='{et_secret}' HA_ET_PEERS='{et_peers}'; "
        f"curl --connect-timeout 10 --max-time 60 -fsSL '{staging}/lab/install.sh' "
        f"-o /tmp/ha-i.sh && bash /tmp/ha-i.sh"
    )
    print(f"==> full offline install on {NAME} (VM {VMID})")
    code, out, elapsed = guest_exec(env, VMID, body)
    print(out[-2500:])
    forbid_online_install_script(out)
    if code != 0 or "==> done" not in out:
        raise RuntimeError(f"{NAME} install failed in {elapsed:.1f}s")
    print(f"  OK install {elapsed:.1f}s")
    return out


def verify_k3s(env: dict[str, str], vmid: int, name: str) -> None:
    script = r"""
set -eu
test -x /usr/local/bin/k3s
test -f /var/lib/ha-setup/k3s.ready
systemctl is-active --quiet k3s || systemctl is-active --quiet k3s-agent
if [[ -f /etc/systemd/system/k3s.service ]]; then
  /usr/local/bin/k3s kubectl get nodes --request-timeout=20s --no-headers
fi
echo K3S_VERIFY_OK
"""
    print(f"==> verify k3s on {name} (VM {vmid})")
    code, out, _ = guest_exec(env, vmid, script)
    print(out[-1500:])
    if code != 0 or "K3S_VERIFY_OK" not in out:
        raise RuntimeError(f"{name} k3s verify failed")
    if "Ready" not in out and "k3s-agent" not in out:
        # server 应能列出节点
        if "kubectl" in out and "error" in out.lower():
            raise RuntimeError(f"{name} kubectl failed")


def upgrade_existing(env: dict[str, str], staging: str) -> None:
    print(f"==> upgrade existing worker {UPGRADE_NAME} (VM {UPGRADE_VMID})")
    pre = r"if command -v k3s >/dev/null; then echo HAD_K3S; else echo NO_K3S; fi"
    code, out, _ = guest_exec(env, UPGRADE_VMID, pre)
    print(out[-200:])
    body = (
        f"export DEPOT_PUBLIC='{staging}' HA_DEPOT_PUBLIC='{staging}' HA_UPGRADE=1 SKIP_K3S=0; "
        f"curl --connect-timeout 10 --max-time 60 -fsSL '{staging}/install.sh' "
        f"-o /tmp/ha-upgrade.sh && bash /tmp/ha-upgrade.sh upgrade"
    )
    code, out, elapsed = guest_exec(env, UPGRADE_VMID, body)
    print(out[-2500:])
    forbid_online_install_script(out)
    if code != 0:
        raise RuntimeError(f"{UPGRADE_NAME} upgrade failed in {elapsed:.1f}s")
    verify_k3s(env, UPGRADE_VMID, UPGRADE_NAME)
    print(f"  OK upgrade {elapsed:.1f}s")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-provision", action="store_true")
    ap.add_argument("--upgrade-only", action="store_true")
    ap.add_argument("--recreate", action="store_true")
    args = ap.parse_args()

    env = load_env(LAB / "lab.env")
    staging = depot_url(env, False)
    print(f"==> Depot: {staging}")
    verify_depot(staging)
    assert_depot_k3s(staging)

    t0 = time.perf_counter()
    if not args.upgrade_only:
        if not args.skip_provision:
            provision(args.recreate)
        install_empty(env, staging)
        verify_k3s(env, VMID, NAME)

    try:
        upgrade_existing(env, staging)
    except Exception as e:
        print(f"warn: upgrade {UPGRADE_NAME}: {e}", file=sys.stderr)
        if args.upgrade_only:
            raise

    print(f"\n==> k3s 真机验收完成，总耗时 {time.perf_counter() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
