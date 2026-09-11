#!/usr/bin/env python3
"""上传 Depot（布局同 packaging/upload-depot-s3.py）。凭证用环境变量。"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("upload_depot_s3", ROOT / "packaging" / "upload-depot-s3.py")
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

if __name__ == "__main__":
    mod.main()
