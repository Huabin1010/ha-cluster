#!/usr/bin/env python3
"""新开一台空 VM，走当前 Depot 离线包做全量安装并验收。

  python deploy/pve-lab/test-offline-fresh.py
  python deploy/pve-lab/test-offline-fresh.py --recreate
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[1]
sys.path.insert(0, str(LAB))
from bootstrap import depot_url, guest_exec, load_env, verify_depot  # noqa: E402
from provision_k3s_vm import provision  # noqa: E402

FRESH_VMID = 117
FRESH_NAME = "ha-offline-fresh"
FRESH_FABRIC = "10.129.129.209"


def assert_depot(base: str) -> None:
    missing = []
    for path in (
        "/lab/install.sh",
        "/lab/worker-install.sh",
        "/lab/install-k3s.sh",
        "/bin/amd64/k3s",
        "/bin/amd64/ha-agent",
        "/bin/amd64/docker-compose",
        "/bundles/amd64/k3s-airgap-images.tar.zst",
        "/bundles/amd64/incus-offline.tar.zst",
    ):
        try:
            urllib.request.urlopen(f"{base}{path}", timeout=20)
        except urllib.error.URLError:
            missing.append(path)
    if missing:
        raise SystemExit(f"Depot 缺制品 {missing}")


def forbid_online(out: str) -> None:
    for needle in ("get.k3s.io", "github.com/k3s-io"):
        if needle in out and "禁止" not in out and "refuse" not in out.lower():
            raise RuntimeError(f"install log mentions online source: {needle}")


def api_login(env: dict) -> str:
    base = env["HA_API_BASE"].rstrip("/")
    body = json.dumps(
        {"username": env.get("HA_ADMIN_USER", "admin"), "password": env.get("HA_ADMIN_PASS", "")}
    ).encode()
    req = urllib.request.Request(base + "/auth/login", data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["token"]


def wait_node(env: dict, name: str, timeout: int = 180) -> dict:
    base = env["HA_API_BASE"].rstrip("/")
    tok = api_login(env)
    t0 = time.time()
    last = {}
    while time.time() - t0 < timeout:
        req = urllib.request.Request(base + "/nodes", headers={"Authorization": "Bearer " + tok})
        with urllib.request.urlopen(req, timeout=15) as r:
            nodes = json.loads(r.read()).get("data") or []
        for n in nodes:
            if n.get("name") == name:
                last = n
                if n.get("ready") and "k3s" in (n.get("tags") or []):
                    return n
        time.sleep(5)
    return last


def main() -> int:
    env = load_env(LAB / "lab.env")
    staging = depot_url(env, False)
    print(f"==> Depot {staging}")
    verify_depot(staging)
    assert_depot(staging)

    provision(False, vmid=FRESH_VMID, name=FRESH_NAME, fabric_ip=FRESH_FABRIC)
    api = env.get("HA_API_BASE", "http://192.168.1.60:8080")
    token = env.get("HA_NODE_TOKEN", "")
    et_secret = env.get("HA_ET_SECRET", "")
    et_peers = env.get("HA_ET_PEERS", "")
    et_net = env.get("HA_ET_NET", "ha-cluster-easytier")
    body = (
        f"export STAGING='{staging}' DEPOT_PUBLIC='{staging}' NODE_NAME='{FRESH_NAME}' "
        f"FABRIC_IP='{FRESH_FABRIC}' HA_API_BASE='{api}' HA_NODE_TOKEN='{token}' "
        f"SKIP_INCUS='0' SKIP_EASYTIER='0' SKIP_K3S='0' "
        f"HA_INSTALL_MODE='offline' HA_APT_MIRROR='tuna' HA_VERIFY_EGRESS='0' "
        f"HA_ET_NET='{et_net}' HA_ET_SECRET='{et_secret}' HA_ET_PEERS='{et_peers}'; "
        f"curl --connect-timeout 10 --max-time 60 -fsSL '{staging}/lab/install.sh' "
        f"-o /tmp/ha-i.sh && bash /tmp/ha-i.sh"
    )
    print(f"==> offline install {FRESH_NAME} VM {FRESH_VMID}")
    t0 = time.time()
    code, out, elapsed = guest_exec(env, FRESH_VMID, body)
    print(out[-3000:])
    forbid_online(out)
    if code != 0 or "==> done" not in out:
        raise SystemExit(f"install failed in {elapsed:.1f}s")
    print(f"  OK install {elapsed:.1f}s")

    verify = r"""
set -eu
test -x /usr/local/bin/k3s
test -f /var/lib/ha-setup/k3s.ready
systemctl is-active --quiet k3s
/usr/local/bin/k3s kubectl get nodes --request-timeout=20s --no-headers
test -x /usr/local/bin/ha-agent
systemctl is-active --quiet ha-agent
systemctl is-active --quiet easytier
command -v incus >/dev/null
test -s /var/lib/ha-cluster/docker-compose
grep -qw avx2 /proc/cpuinfo
echo FRESH_VERIFY_OK
"""
    print("==> verify guest")
    code, vout, _ = guest_exec(env, FRESH_VMID, verify)
    print(vout[-1500:])
    if code != 0 or "FRESH_VERIFY_OK" not in vout:
        raise SystemExit("guest verify failed")
    if "Ready" not in vout:
        raise SystemExit("k3s node not Ready")

    node = wait_node(env, FRESH_NAME)
    if not node.get("ready"):
        raise SystemExit(f"API 未看到 Ready 节点 {FRESH_NAME}: {node}")
    print(f"  OK heartbeat {FRESH_NAME} tags={node.get('tags')} fabric={node.get('fabric_ip')}")
    print(f"\n==> 空机离线安装通过  total={time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
