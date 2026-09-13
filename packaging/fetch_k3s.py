#!/usr/bin/env python3
"""维护者机：从 GitHub 拉冻结 k3s 二进制 + airgap 到 packaging/cache/。

目标机安装禁止跑本脚本；目标机只从 Depot S3 拉已上传制品。
Usage: python packaging/fetch_k3s.py [amd64|arm64|all]
"""
from __future__ import annotations

import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "packaging" / "cache"


def k3s_version() -> str:
    versions = ROOT / "packaging" / "versions.env"
    for line in versions.read_text(encoding="utf-8").splitlines():
        if line.startswith("K3S_VERSION="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("K3S_VERSION missing in packaging/versions.env")


def asset_url(version: str, filename: str) -> str:
    tag = urllib.parse.quote(version, safe="")
    return f"https://github.com/k3s-io/k3s/releases/download/{tag}/{filename}"


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size > 0:
        print(f"  skip (exists): {dest}")
        return
    print(f"  GET {url}")
    tmp = dest.with_suffix(dest.suffix + ".partial")
    req = urllib.request.Request(url, headers={"User-Agent": "ha-cluster-fetch-k3s"})
    with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    tmp.replace(dest)


def fetch_arch(arch: str, version: str) -> None:
    if arch not in ("amd64", "arm64"):
        raise SystemExit(f"unsupported arch {arch}")
    d = CACHE / arch / "k3s"
    d.mkdir(parents=True, exist_ok=True)
    bin_name = "k3s" if arch == "amd64" else "k3s-arm64"
    print(f"==> fetch k3s {version} {arch}")
    download(asset_url(version, bin_name), d / bin_name)
    if bin_name != "k3s":
        data = (d / bin_name).read_bytes()
        (d / "k3s").write_bytes(data)
    os.chmod(d / "k3s", 0o755)
    download(asset_url(version, f"k3s-airgap-images-{arch}.tar.zst"), d / f"k3s-airgap-images-{arch}.tar.zst")
    (d / "VERSION").write_text(version + "\n", encoding="utf-8")
    print(f"  ok {d}")


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else "amd64"
    version = k3s_version()
    arches = ("amd64", "arm64") if arg == "all" else (arg,)
    for arch in arches:
        fetch_arch(arch, version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
