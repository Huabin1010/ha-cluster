#!/usr/bin/env python3
"""打包 pve-lab 离线制品到 dist/pve-lab/（统一 LF，供 Depot 上传）。"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAB = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "pve-lab"
MIRROR = ROOT / "dist" / "depot-mirror"
sys.path.insert(0, str(ROOT / "packaging"))
from depot_layout import build_mirror_tree, LAB_FILES  # noqa: E402
CACHE_AMD = ROOT / "packaging" / "cache" / "amd64"


def lf_write(path: Path, text: str) -> None:
    path.write_text(text.replace("\r\n", "\n"), encoding="utf-8", newline="\n")


def _incus_suite_dirs(arch: str) -> list[tuple[str, Path]]:
    """Return (suite, debs_dir) for every cached Zabbly suite."""
    incus_root = ROOT / "packaging" / "cache" / arch / "incus"
    suites: list[tuple[str, Path]] = []
    versions = (ROOT / "packaging" / "versions.env").read_text(encoding="utf-8")
    suite_list = "jammy noble resolute"
    for line in versions.splitlines():
        if line.startswith("INCUS_ZABBLY_SUITES="):
            suite_list = line.split("=", 1)[1].strip().strip('"')
            break
    for suite in suite_list.split():
        deb_dir = incus_root / suite / "debs"
        if any(deb_dir.glob("*.deb")):
            suites.append((suite, deb_dir))
    # Legacy flat layout: packaging/cache/amd64/incus/debs/*.deb
    legacy = incus_root / "debs"
    if not suites and any(legacy.glob("*.deb")):
        suites.append(("jammy", legacy))
    return suites


def build_incus_offline_tar(arch: str = "amd64") -> Path:
    """incus-offline-amd64.tar.zst: debs/<suite>/ + images/ubuntu rootfs."""
    suite_dirs = _incus_suite_dirs(arch)
    if not suite_dirs:
        raise SystemExit(f"error: run bash packaging/fetch-incus.sh {arch} all first")

    # shellcheck source=versions.env
    versions = (ROOT / "packaging" / "versions.env").read_text(encoding="utf-8")
    series = "24.04"
    for line in versions.splitlines():
        if line.startswith("UBUNTU_CLOUD_SERIES="):
            series = line.split("=", 1)[1].strip().strip('"')
            break
    rootfs_name = f"ubuntu-{series}-server-cloudimg-{arch}-root.tar.xz"
    rootfs = CACHE_AMD / "images" / rootfs_name
    if not rootfs.is_file():
        raise SystemExit(f"error: missing {rootfs} — run bash packaging/fetch-deps.sh {arch}")

    ws_debs = CACHE_AMD / "workspace-debs"
    if not any(ws_debs.glob("*.deb")):
        print("==> fetch workspace docker debs")
        subprocess.run(
            ["bash", str(ROOT / "packaging" / "fetch-workspace-docker.sh"), arch],
            cwd=ROOT,
            check=True,
        )

    out_tar = OUT / f"incus-offline-{arch}.tar.zst"
    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        deb_root = stage / "debs"
        img_dst = stage / "images"
        ws_dst = stage / "workspace-debs"
        deb_root.mkdir()
        img_dst.mkdir()
        ws_dst.mkdir()
        for suite, deb_src in suite_dirs:
            deb_dst = deb_root / suite
            deb_dst.mkdir(parents=True, exist_ok=True)
            for deb in deb_src.glob("*.deb"):
                shutil.copy2(deb, deb_dst / deb.name)
        # Bundle manifest for installers
        (deb_root / "SUITES.txt").write_text(
            "\n".join(s for s, _ in suite_dirs) + "\n",
            encoding="utf-8",
        )
        shutil.copy2(rootfs, img_dst / rootfs.name)
        for deb in ws_debs.glob("*.deb"):
            shutil.copy2(deb, ws_dst / deb.name)

        # 在线安装用：仅 images + workspace-debs（~300MiB，无 Incus deb）
        ws_assets = OUT / f"workspace-assets-{arch}.tar.zst"
        plain_ws = stage / "workspace-assets.tar"
        with tarfile.open(plain_ws, "w") as tf:
            tf.add(img_dst, arcname="images")
            tf.add(ws_dst, arcname="workspace-debs")
        subprocess.run(
            ["zstd", "-T0", "-3", "-f", str(plain_ws), "-o", str(ws_assets)],
            check=True,
        )
        shutil.copy2(ws_assets, ROOT / "dist" / f"workspace-assets-{arch}.tar.zst")

        plain = stage / "bundle.tar"
        with tarfile.open(plain, "w") as tf:
            tf.add(deb_root, arcname="debs")
            tf.add(img_dst, arcname="images")
            tf.add(ws_dst, arcname="workspace-debs")

        subprocess.run(
            ["zstd", "-T0", "-3", "-f", str(plain), "-o", str(out_tar)],
            check=True,
        )
    print(f"  wrote {out_tar.name} ({out_tar.stat().st_size // (1024 * 1024)} MiB)")
    return out_tar


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    agent = OUT / "ha-agent-linux-amd64"
    subprocess.run(
        ["go", "build", "-o", str(agent), "./cmd/ha-agent"],
        cwd=ROOT,
        check=True,
        env={**os.environ, "GOOS": "linux", "GOARCH": "amd64", "CGO_ENABLED": "0"},
    )

    et = CACHE_AMD / "easytier" / "easytier-core"
    if not et.is_file():
        print("error: run bash packaging/fetch-deps.sh amd64 first", file=sys.stderr)
        return 1
    shutil.copy2(et, OUT / "easytier-core")

    for name in LAB_FILES:
        if name == "MANIFEST.txt":
            continue
        src = LAB / name
        if src.is_file():
            lf_write(OUT / name, src.read_text(encoding="utf-8"))

    lf_write(OUT / "easytier-start.sh", (ROOT / "deploy" / "easytier-start.sh").read_text(encoding="utf-8"))
    shutil.copy2(ROOT / "deploy" / "easytier.service", OUT / "easytier.service")

    build_incus_offline_tar("amd64")

    manifest = "\n".join(sorted(p.name for p in OUT.iterdir() if p.is_file()))
    lf_write(OUT / "MANIFEST.txt", manifest + "\n")

    build_mirror_tree(MIRROR, ROOT / "dist", ROOT, OUT)
    print(f"packed {OUT} + mirror {MIRROR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
