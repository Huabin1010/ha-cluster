#!/usr/bin/env python3
"""打包 pve-lab 离线制品到 dist/pve-lab/（统一 LF，供 Depot 上传）。"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAB = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "pve-lab"


def lf_write(path: Path, text: str) -> None:
    path.write_text(text.replace("\r\n", "\n"), encoding="utf-8", newline="\n")


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

    et = ROOT / "packaging" / "cache" / "amd64" / "easytier" / "easytier-core"
    if not et.is_file():
        print("error: run bash packaging/fetch-deps.sh amd64 first", file=sys.stderr)
        return 1
    shutil.copy2(et, OUT / "easytier-core")

    for name in (
        "install.sh",
        "reinstall.sh",
        "worker-install.sh",
        "reset-worker.sh",
        "install-easytier.sh",
        "install-incus.sh",
        "lab.defaults.env",
    ):
        src = LAB / name
        if src.is_file():
            lf_write(OUT / name, src.read_text(encoding="utf-8"))

    lf_write(OUT / "easytier-start.sh", (ROOT / "deploy" / "easytier-start.sh").read_text(encoding="utf-8"))
    shutil.copy2(ROOT / "deploy" / "easytier.service", OUT / "easytier.service")

    manifest = "\n".join(sorted(p.name for p in OUT.iterdir() if p.is_file()))
    lf_write(OUT / "MANIFEST.txt", manifest + "\n")
    print(f"packed {OUT} ({len(list(OUT.iterdir()))} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
