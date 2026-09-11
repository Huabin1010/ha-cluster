#!/usr/bin/env python3
"""Upload dist/ to S3。键布局见 depot_layout.py；上传后写入 INDEX.md。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import boto3
except ImportError:
    print("error: pip install boto3", file=sys.stderr)
    sys.exit(1)

from depot_layout import PREFIX, collect_uploads, generate_index, public_base

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
LAB = DIST / "pve-lab"

ENDPOINT = os.environ["HA_DEPOT_S3_ENDPOINT"]
BUCKET = os.environ["HA_DEPOT_S3_BUCKET"]
AK = os.environ["HA_DEPOT_S3_ACCESS_KEY"]
SK = os.environ["HA_DEPOT_S3_SECRET_KEY"]
REGION = os.environ.get("HA_DEPOT_S3_REGION", "us-east-1")

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=AK,
    aws_secret_access_key=SK,
    region_name=REGION,
)


def put(local: Path, key: str, content_type: str | None = None) -> None:
    extra = {}
    if content_type:
        extra["ContentType"] = content_type
    s3.upload_file(str(local), BUCKET, f"{PREFIX}/{key}", ExtraArgs=extra or None)
    mib = local.stat().st_size / (1024 * 1024)
    print(f"  {key}  ({mib:.1f} MiB)" if mib >= 0.01 else f"  {key}  ({local.stat().st_size} B)")


def main() -> None:
    base = public_base(ENDPOINT, BUCKET)
    uploads = collect_uploads(DIST, ROOT, LAB)
    index_path = DIST / "INDEX.md"
    index_path.write_text(generate_index(uploads, base), encoding="utf-8")
    uploads.append((index_path, "INDEX.md", "text/markdown"))

    print(f"==> upload {len(uploads)} objects → {PREFIX}/")
    for local, key, ct in uploads:
        put(local, key, ct)

    print(f"\nPublic: {base}")
    print(f"Index:  {base}/INDEX.md")
    print(f"Join:   curl -fsSL {base}/install.sh | sudo bash -s join --token '…'")


if __name__ == "__main__":
    for var in ("HA_DEPOT_S3_ENDPOINT", "HA_DEPOT_S3_BUCKET", "HA_DEPOT_S3_ACCESS_KEY", "HA_DEPOT_S3_SECRET_KEY"):
        if var not in os.environ:
            print(f"error: set {var}", file=sys.stderr)
            sys.exit(2)
    main()
