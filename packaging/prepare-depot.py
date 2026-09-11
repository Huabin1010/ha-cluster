#!/usr/bin/env python3
"""一键：交叉编译 → pack → INDEX → 上传 S3。"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
LAB = ROOT / "deploy" / "pve-lab"
sys.path.insert(0, str(ROOT / "packaging"))

from depot_layout import build_mirror_tree, collect_uploads, generate_index, public_base  # noqa: E402

BINS = (
    ("./cmd/ha-agent", "ha-agent-linux-{arch}"),
    ("./cmd/ha-setup", "ha-setup-linux-{arch}"),
    ("./cmd/ha-bastion-proxy", "ha-bastion-linux-{arch}"),
)


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd or ROOT, check=True)


def wsl_bash(script: str) -> None:
    win = str(ROOT).replace("\\", "/")
    wsl_path = "/mnt/" + win[0].lower() + win[2:] if len(win) > 2 and win[1] == ":" else win
    run(["bash", "-lc", f"cd '{wsl_path}' && {script}"])


def go_build() -> None:
    DIST.mkdir(parents=True, exist_ok=True)
    env_base = {**os.environ, "CGO_ENABLED": "0"}
    for arch in ("amd64", "arm64"):
        for pkg, name in BINS:
            out = DIST / name.format(arch=arch)
            subprocess.run(
                ["go", "build", "-trimpath", "-ldflags=-s -w", "-o", str(out), pkg],
                cwd=ROOT,
                check=True,
                env={**env_base, "GOOS": "linux", "GOARCH": arch},
            )


def main() -> int:
    print("==> go build amd64 + arm64")
    go_build()

    print("==> fetch-deps + pack amd64")
    try:
        wsl_bash("bash packaging/fetch-deps.sh amd64")
        wsl_bash("bash packaging/pack.sh amd64")
    except subprocess.CalledProcessError as e:
        print(f"warn: amd64 pack: {e}", file=sys.stderr)

    print("==> fetch-deps + pack arm64 (若网络可用)")
    try:
        wsl_bash("bash packaging/fetch-deps.sh arm64")
        wsl_bash("bash packaging/pack.sh arm64")
    except subprocess.CalledProcessError as e:
        print(f"warn: arm64 pack skipped: {e}", file=sys.stderr)

    print("==> pve-lab pack")
    run([sys.executable, str(LAB / "pack.py")])

    endpoint = os.environ.get("HA_DEPOT_S3_ENDPOINT", "https://rustfs.s.ggss.club:50000")
    bucket = os.environ.get("HA_DEPOT_S3_BUCKET", "typora")
    base = public_base(endpoint, bucket)
    uploads = collect_uploads(DIST, ROOT, LAB)
    index_text = generate_index(uploads, base)
    (DIST / "INDEX.md").write_text(index_text, encoding="utf-8")
    build_mirror_tree(DIST / "depot-mirror", DIST, ROOT, LAB)
    print(index_text)

    if all(os.environ.get(v) for v in ("HA_DEPOT_S3_ENDPOINT", "HA_DEPOT_S3_BUCKET", "HA_DEPOT_S3_ACCESS_KEY", "HA_DEPOT_S3_SECRET_KEY")):
        print("==> upload")
        run([sys.executable, str(ROOT / "packaging" / "upload-depot-s3.py")])
    else:
        print("skip upload: set HA_DEPOT_S3_* env")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
