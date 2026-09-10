#!/usr/bin/env python3
"""Upload dist/ + install.sh to S3-compatible Depot (RustFS). Windows-friendly."""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import boto3
except ImportError:
    print("error: pip install boto3", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
PREFIX = os.environ.get("HA_DEPOT_S3_PREFIX", "ha-cluster")
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
    print(f"uploaded {key}")


def main() -> None:
    put(ROOT / "packaging/install.sh", "install.sh", "text/x-shellscript")
    for arch in ("amd64", "arm64"):
        for name in (
            f"ha-setup-linux-{arch}",
            f"ha-payload-linux-{arch}.tar.zst",
            f"ha-worker-bundle-linux-{arch}.tar.zst",
        ):
            p = DIST / name
            if p.is_file():
                put(p, name)
        payload_dir = DIST / f"payload-linux-{arch}"
        if payload_dir.is_dir():
            for path in sorted(payload_dir.rglob("*")):
                if path.is_file():
                    rel = path.relative_to(payload_dir).as_posix()
                    put(path, f"payload-linux-{arch}/{rel}")
    versions = DIST / "VERSIONS.md"
    if versions.is_file():
        put(versions, "VERSIONS.md", "text/markdown")
    public = os.environ.get("HA_DEPOT_PUBLIC", f"{ENDPOINT.rstrip('/')}/{BUCKET}/{PREFIX}")
    print(f"\nPublic base: {public}")
    print(f"curl -fsSL {public}/install.sh | sudo bash -s join --token 'ha://join/...'")


if __name__ == "__main__":
    for var in ("HA_DEPOT_S3_ENDPOINT", "HA_DEPOT_S3_BUCKET", "HA_DEPOT_S3_ACCESS_KEY", "HA_DEPOT_S3_SECRET_KEY"):
        if var not in os.environ:
            print(f"error: set {var}", file=sys.stderr)
            sys.exit(2)
    main()
