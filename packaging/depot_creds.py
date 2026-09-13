#!/usr/bin/env python3
"""把 Depot S3 凭据灌进 os.environ。不打印密钥。"""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEYS = (
    "HA_DEPOT_S3_ENDPOINT",
    "HA_DEPOT_S3_BUCKET",
    "HA_DEPOT_S3_ACCESS_KEY",
    "HA_DEPOT_S3_SECRET_KEY",
)


def _parse_kv_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    text = path.read_text(encoding="utf-8")
    for raw in text.splitlines():
        line = raw.strip().lstrip("-").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip("`").strip('"').strip("'")
        if k in KEYS or k.startswith("HA_DEPOT"):
            out[k] = v
    table = {
        "Access Key": "HA_DEPOT_S3_ACCESS_KEY",
        "Secret Key": "HA_DEPOT_S3_SECRET_KEY",
        "Endpoint": "HA_DEPOT_S3_ENDPOINT",
        "Bucket": "HA_DEPOT_S3_BUCKET",
    }
    for label, envk in table.items():
        if envk in out:
            continue
        m = re.search(rf"\|\s*{re.escape(label)}\s*\|\s*`?([^`|\n]+)`?", text)
        if m:
            out[envk] = m.group(1).strip().strip("`")
    return out


def load_depot_creds() -> None:
    os.environ.setdefault("HA_DEPOT_S3_BUCKET", "typora")
    for path in (
        ROOT / "docs" / "credentials.local.md",
        ROOT / "deploy" / "pve-lab" / "lab.env",
    ):
        parsed = _parse_kv_file(path)
        for k, v in parsed.items():
            os.environ.setdefault(k, v)
    if not os.environ.get("HA_DEPOT_S3_ENDPOINT"):
        os.environ["HA_DEPOT_S3_ENDPOINT"] = "http://192.168.1.9:10000"


def require_depot_creds() -> None:
    load_depot_creds()
    missing = [k for k in KEYS if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"missing {', '.join(missing)} (env or docs/credentials.local.md)")
