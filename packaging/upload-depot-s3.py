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

from depot_creds import require_depot_creds
from depot_layout import LAB_FILES, PREFIX, collect_uploads, generate_index, public_base


def lf_stage_lab() -> None:
    """Windows 检出的 lab 脚本必须转 LF，否则目标机 shebang 会炸。"""
    src = ROOT / "deploy" / "pve-lab"
    dest = LAB
    dest.mkdir(parents=True, exist_ok=True)
    for name in LAB_FILES:
        p = src / name
        if not p.is_file():
            continue
        text = p.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
        (dest / name).write_text(text, encoding="utf-8", newline="\n")

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
LAB = DIST / "pve-lab"


def client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["HA_DEPOT_S3_ENDPOINT"],
        aws_access_key_id=os.environ["HA_DEPOT_S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["HA_DEPOT_S3_SECRET_KEY"],
        region_name=os.environ.get("HA_DEPOT_S3_REGION", "us-east-1"),
    )


def put(s3, local: Path, key: str, content_type: str | None = None) -> None:
    extra = {}
    if content_type:
        extra["ContentType"] = content_type
    bucket = os.environ["HA_DEPOT_S3_BUCKET"]
    s3_key = f"{PREFIX}/{key}"
    if local.suffix == ".sh" or local.name in {"install.sh", "lab.defaults.env"}:
        data = local.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        extra["Body"] = data
        extra["Key"] = s3_key
        extra["Bucket"] = bucket
        s3.put_object(**extra)
        size = len(data)
    else:
        s3.upload_file(str(local), bucket, s3_key, ExtraArgs={k: v for k, v in extra.items() if k == "ContentType"} or None)
        size = local.stat().st_size
    mib = size / (1024 * 1024)
    print(f"  {key}  ({mib:.1f} MiB)" if mib >= 0.01 else f"  {key}  ({size} B)")


def main() -> None:
    require_depot_creds()
    lf_stage_lab()
    s3 = client()
    endpoint = os.environ["HA_DEPOT_S3_ENDPOINT"]
    bucket = os.environ["HA_DEPOT_S3_BUCKET"]
    base = public_base(endpoint, bucket)
    uploads = collect_uploads(DIST, ROOT, LAB)
    index_path = DIST / "INDEX.md"
    index_path.write_text(generate_index(uploads, base), encoding="utf-8")
    uploads.append((index_path, "INDEX.md", "text/markdown"))

    print(f"==> upload {len(uploads)} objects → {PREFIX}/")
    for local, key, ct in uploads:
        put(s3, local, key, ct)

    print(f"\nPublic: {base}")
    print(f"Index:  {base}/INDEX.md")
    print(f"Join:   curl -fsSL {base}/install.sh | sudo bash -s join --token '…'")


if __name__ == "__main__":
    main()
