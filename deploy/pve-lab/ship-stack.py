#!/usr/bin/env python3
"""打包 PVE 实验室全栈部署包 → dist/ha-cluster-stack.tar.gz"""
from __future__ import annotations

import gzip
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STACK = Path(__file__).resolve().parent / "stack"
OUT = ROOT / "dist" / "ha-cluster-stack"
ARCHIVE = ROOT / "dist" / "ha-cluster-stack.tar.gz"
ET_CACHE = ROOT / "packaging" / "cache" / "amd64" / "easytier" / "easytier-core"


def run(cmd: list[str], **kw) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True, **kw)


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    # docker image
    image = "ha-cluster-api:local"
    run(["docker", "build", "-f", str(ROOT / "docker" / "Dockerfile"), "-t", image, str(ROOT)])
    def save_image(ref: str, name: str, pull: bool = False) -> None:
        if pull:
            subprocess.run(["docker", "pull", ref], check=True)
        raw = subprocess.check_output(["docker", "save", ref])
        out = OUT / name
        with gzip.open(out, "wb", compresslevel=6) as f:
            f.write(raw)

    save_image(image, "ha-api-image.tar.gz")
    save_image("postgres:16-alpine", "postgres-image.tar.gz", pull=True)

    def lf_copy(src: Path, dst: Path) -> None:
        if src.suffix == ".sh" or src.name.endswith(".env") or src.name == "env.example":
            dst.write_text(src.read_text(encoding="utf-8").replace("\r\n", "\n"), encoding="utf-8", newline="\n")
        else:
            shutil.copy2(src, dst)

    for name in ("docker-compose.yaml", "env.example", "install-stack.sh", "install-hub.sh"):
        lf_copy(STACK / name, OUT / name)
    lf_copy(ROOT / "deploy" / "easytier-start.sh", OUT / "easytier-start.sh")

    if not ET_CACHE.is_file():
        print("error: missing easytier-core — run: bash packaging/fetch-deps.sh amd64", file=sys.stderr)
        return 1
    shutil.copy2(ET_CACHE, OUT / "easytier-core")

    for script in ("install-stack.sh", "install-hub.sh", "easytier-start.sh"):
        (OUT / script).chmod(0o755)

    if ARCHIVE.exists():
        ARCHIVE.unlink()
    with tarfile.open(ARCHIVE, "w:gz") as tf:
        tf.add(OUT, arcname="ha-cluster-stack")

    mb = ARCHIVE.stat().st_size // (1024 * 1024)
    print(f"packed {ARCHIVE} ({mb} MiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
