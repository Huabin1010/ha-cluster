#!/usr/bin/env python3
"""上传 dist/pve-lab/ 到 Depot（RustFS S3）。凭证用环境变量，勿提交。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import boto3
except ImportError:
    print("pip install boto3", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "dist" / "pve-lab"
PREFIX = os.environ.get("HA_DEPOT_S3_PREFIX", "ha-cluster")
ENDPOINT = os.environ["HA_DEPOT_S3_ENDPOINT"]
BUCKET = os.environ["HA_DEPOT_S3_BUCKET"]
AK = os.environ["HA_DEPOT_S3_ACCESS_KEY"]
SK = os.environ["HA_DEPOT_S3_SECRET_KEY"]

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=AK,
    aws_secret_access_key=SK,
    region_name=os.environ.get("HA_DEPOT_S3_REGION", "us-east-1"),
)


def main() -> int:
    if not SRC.is_dir():
        print(f"run pack.py first — missing {SRC}", file=sys.stderr)
        return 1
    for path in sorted(SRC.iterdir()):
        if not path.is_file():
            continue
        key = f"{PREFIX}/pve-lab/{path.name}"
        ct = "text/x-shellscript" if path.suffix == ".sh" else None
        extra = {"ContentType": ct} if ct else {}
        s3.upload_file(str(path), BUCKET, key, ExtraArgs=extra or None)
        print(f"uploaded {key}")
    public = os.environ.get("HA_DEPOT_PUBLIC", f"{ENDPOINT.rstrip('/')}/{BUCKET}/{PREFIX}")
    print(f"\ninstall: curl -fsSL {public}/pve-lab/install.sh | bash")
    return 0


if __name__ == "__main__":
    for v in ("HA_DEPOT_S3_ENDPOINT", "HA_DEPOT_S3_BUCKET", "HA_DEPOT_S3_ACCESS_KEY", "HA_DEPOT_S3_SECRET_KEY"):
        if v not in os.environ:
            sys.exit(f"set {v}")
    raise SystemExit(main())
