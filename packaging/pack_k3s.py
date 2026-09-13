#!/usr/bin/env python3
"""从 packaging/cache 打出 k3s 离线包到 dist/（gzip，目标机无需 zstd 解外包）。"""
from __future__ import annotations

import shutil
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


def pack_arch(arch: str) -> Path:
    cache = ROOT / "packaging" / "cache" / arch / "k3s"
    binary = cache / "k3s"
    airgap = cache / f"k3s-airgap-images-{arch}.tar.zst"
    if not binary.is_file() or not airgap.is_file():
        raise SystemExit(
            f"error: missing k3s cache for {arch} — run python packaging/fetch_k3s.py {arch}"
        )
    DIST.mkdir(parents=True, exist_ok=True)
    dest_bin = DIST / f"k3s-linux-{arch}"
    shutil.copy2(binary, dest_bin)
    dest_img = DIST / f"k3s-airgap-images-{arch}.tar.zst"
    shutil.copy2(airgap, dest_img)

    out = DIST / f"ha-k3s-offline-linux-{arch}.tar.gz"
    version = "unknown"
    ver_file = cache / "VERSION"
    if ver_file.is_file():
        version = ver_file.read_text(encoding="utf-8").strip()
    with tarfile.open(out, "w:gz") as tf:
        tf.add(binary, arcname="k3s")
        tf.add(airgap, arcname="k3s-airgap-images.tar.zst")
        info = tarfile.TarInfo("VERSION")
        payload = (version + "\n").encode()
        info.size = len(payload)
        import io

        tf.addfile(info, io.BytesIO(payload))
        info_a = tarfile.TarInfo("ARCH")
        ap = (arch + "\n").encode()
        info_a.size = len(ap)
        tf.addfile(info_a, io.BytesIO(ap))
    print(f"  wrote {out.name} ({out.stat().st_size // (1024 * 1024)} MiB)")
    return out


def main() -> int:
    import sys

    arg = sys.argv[1] if len(sys.argv) > 1 else "amd64"
    arches = ("amd64", "arm64") if arg == "all" else (arg,)
    for arch in arches:
        pack_arch(arch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
