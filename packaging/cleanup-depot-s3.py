#!/usr/bin/env python3
"""删除 S3 上 ha-cluster/ 旧扁平键，保留 depot_layout.py 定义的布局。"""
from __future__ import annotations

import os
import sys

try:
    import boto3
except ImportError:
    print("error: pip install boto3", file=sys.stderr)
    sys.exit(1)

from depot_layout import PREFIX

ENDPOINT = os.environ["HA_DEPOT_S3_ENDPOINT"]
BUCKET = os.environ["HA_DEPOT_S3_BUCKET"]
AK = os.environ["HA_DEPOT_S3_ACCESS_KEY"]
SK = os.environ["HA_DEPOT_S3_SECRET_KEY"]

# 旧路径前缀 / 文件名 — 不再上传
LEGACY_PREFIXES = (
    f"{PREFIX}/pve-lab/",
    f"{PREFIX}/ha-worker-bundle-linux-amd64/",
)
LEGACY_KEYS = {
    f"{PREFIX}/ha-worker-bundle-linux-amd64.tar.zst",
    f"{PREFIX}/upload-depot-s3.sh",
}

ALLOWED_TOP = {"", "install.sh", "INDEX.md", "VERSIONS.md", "bundles", "bin", "lab", "edge"}


def is_legacy(key: str) -> bool:
    if key in LEGACY_KEYS:
        return True
    for p in LEGACY_PREFIXES:
        if key.startswith(p):
            return True
    rel = key[len(PREFIX) + 1 :] if key.startswith(f"{PREFIX}/") else key
    top = rel.split("/", 1)[0] if rel else ""
    if top and top not in ALLOWED_TOP:
        return True
    return False


def main() -> None:
    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=AK,
        aws_secret_access_key=SK,
        region_name=os.environ.get("HA_DEPOT_S3_REGION", "us-east-1"),
    )
    resp = s3.list_objects_v2(Bucket=BUCKET, Prefix=f"{PREFIX}/")
    keys = [o["Key"] for o in resp.get("Contents", [])]
    legacy = sorted(k for k in keys if is_legacy(k))
    if not legacy:
        print("no legacy keys to delete")
        return
    print(f"==> delete {len(legacy)} legacy object(s)")
    for k in legacy:
        print(f"  - {k}")
        s3.delete_object(Bucket=BUCKET, Key=k)
    print("done")


if __name__ == "__main__":
    for var in ("HA_DEPOT_S3_ENDPOINT", "HA_DEPOT_S3_BUCKET", "HA_DEPOT_S3_ACCESS_KEY", "HA_DEPOT_S3_SECRET_KEY"):
        if var not in os.environ:
            print(f"error: set {var}", file=sys.stderr)
            sys.exit(2)
    main()
