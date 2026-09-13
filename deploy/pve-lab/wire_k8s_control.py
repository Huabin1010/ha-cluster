#!/usr/bin/env python3
"""把实验室控制面（VM 113）接到 ha-k3s-lab 的真 k3s：kubeconfig + kubectl + 新 ha-api。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packaging"))
from bootstrap import guest_exec, load_env  # noqa: E402
from depot_creds import require_depot_creds  # noqa: E402
from depot_layout import PREFIX  # noqa: E402

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[1]
API_BIN = ROOT / "dist" / "ha-api-linux-amd64"
DEPOT = "http://192.168.1.9:10000/typora/ha-cluster"
K3S_SERVER = "https://10.129.129.208:6443"
CONTROL_VMID = 113
K3S_VMID = 116
K3S_LAN = "192.168.1.57"


def out_data(raw: str) -> str:
    import json

    try:
        j = json.loads(raw[raw.find("{") :])
        return (j.get("out-data") or "") + (j.get("err-data") or "")
    except json.JSONDecodeError:
        return raw


def run(env: dict, vmid: int, script: str, label: str) -> str:
    print(f"==> {label}")
    code, raw, elapsed = guest_exec(env, vmid, script)
    text = out_data(raw)
    print(text[-1500:])
    print(f"    ({elapsed:.1f}s code={code})")
    if code != 0:
        raise SystemExit(f"fail: {label}")
    return text


def upload_api() -> None:
    os.environ["HA_DEPOT_S3_ENDPOINT"] = "http://192.168.1.9:10000"
    require_depot_creds()
    import boto3

    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["HA_DEPOT_S3_ENDPOINT"],
        aws_access_key_id=os.environ["HA_DEPOT_S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["HA_DEPOT_S3_SECRET_KEY"],
        region_name=os.environ.get("HA_DEPOT_S3_REGION", "us-east-1"),
    )
    s3.upload_file(str(API_BIN), os.environ["HA_DEPOT_S3_BUCKET"], f"{PREFIX}/lab/ha-api")
    print(f"==> uploaded lab/ha-api ({API_BIN.stat().st_size // 1024} KiB)")


def main() -> int:
    if not API_BIN.is_file():
        print(f"error: missing {API_BIN}", file=sys.stderr)
        return 1
    env = load_env(LAB / "lab.env")
    upload_api()

    run(
        env,
        K3S_VMID,
        "sed 's#https://127.0.0.1:6443#"
        + K3S_SERVER
        + "#; s#https://localhost:6443#"
        + K3S_SERVER
        + "#' /etc/rancher/k3s/k3s.yaml > /tmp/k3s.kubeconfig && "
        "chmod 644 /tmp/k3s.kubeconfig && "
        "nohup python3 -m http.server 18765 --bind 0.0.0.0 --directory /tmp >/tmp/kc-http.log 2>&1 & "
        "sleep 1; echo KC_HTTP_OK",
        "ha-k3s-lab publish kubeconfig on :18765",
    )

    overlay = (
        "services:\n"
        "  api:\n"
        "    environment:\n"
        "      HA_KUBECONFIG: /etc/ha-cluster/kubeconfig\n"
        "    volumes:\n"
        "      - /etc/ha-cluster/kubeconfig:/etc/ha-cluster/kubeconfig:ro\n"
        "      - /usr/local/bin/k3s:/usr/local/bin/k3s:ro\n"
        "      - /usr/local/bin/kubectl:/usr/local/bin/kubectl:ro\n"
        "      - /opt/ha-cluster/ha-api:/app/ha-api:ro\n"
    )
    # 分段写 overlay，避免 QMP 命令过长
    run(env, CONTROL_VMID, "mkdir -p /etc/ha-cluster /opt/ha-cluster /usr/local/bin /opt/ha-cluster-stack/ha-cluster-stack", "mkdir")
    run(
        env,
        CONTROL_VMID,
        f"curl -fsSL --connect-timeout 5 --max-time 15 -o /etc/ha-cluster/kubeconfig http://{K3S_LAN}:18765/k3s.kubeconfig && "
        "chmod 600 /etc/ha-cluster/kubeconfig && grep -q clusters /etc/ha-cluster/kubeconfig && echo KC_OK",
        "pull kubeconfig from ha-k3s-lab",
    )
    run(env, K3S_VMID, "pkill -f 'http.server 18765' || true; rm -f /tmp/k3s.kubeconfig; echo STOPPED", "stop kubeconfig http")

    ov_path = "/opt/ha-cluster-stack/ha-cluster-stack/docker-compose.k8s.yaml"
    run(env, CONTROL_VMID, f"cat > {ov_path} <<'EOF'\n{overlay}EOF\n", "write compose overlay")

    run(
        env,
        CONTROL_VMID,
        f"test -x /usr/local/bin/k3s || curl -fsSL --connect-timeout 15 --max-time 180 -o /usr/local/bin/k3s {DEPOT}/bin/amd64/k3s; "
        "chmod 0755 /usr/local/bin/k3s; "
        "printf '%s\\n' '#!/bin/sh' 'exec /usr/local/bin/k3s kubectl \"$@\"' > /usr/local/bin/kubectl; "
        "chmod 0755 /usr/local/bin/kubectl; "
        f"curl -fsSL --connect-timeout 15 --max-time 180 -o /opt/ha-cluster/ha-api {DEPOT}/lab/ha-api; "
        "chmod 0755 /opt/ha-cluster/ha-api; "
        "echo BINS_OK",
        "install k3s kubectl wrapper + ha-api",
    )
    run(
        env,
        CONTROL_VMID,
        "cd /opt/ha-cluster-stack/ha-cluster-stack; "
        "grep -q '^HA_KUBECONFIG=' stack.env 2>/dev/null || echo HA_KUBECONFIG=/etc/ha-cluster/kubeconfig >> stack.env; "
        "docker compose --env-file stack.env -f docker-compose.yaml -f docker-compose.k8s.yaml up -d --force-recreate --no-deps api; "
        "for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8080/healthz >/dev/null && echo API_HEALTHY && "
        "curl -fsS http://127.0.0.1:8080/agent-pack/version && exit 0; sleep 2; done; "
        "docker compose --env-file stack.env logs api --tail 50; exit 1",
        "recreate api with kubeconfig",
    )
    print("==> control plane wired to k3s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
