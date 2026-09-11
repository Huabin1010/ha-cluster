"""Depot（RustFS S3）对象键布局 — 单一来源。改路径只改此文件 + packaging/install.sh。"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

PREFIX = "ha-cluster"
BUCKET = "typora"
ARCHES = ("amd64", "arm64")

# RustFS S3：公网与局域网同一 bucket/键布局，仅 endpoint 不同。
DEPOT_PUBLIC_ENDPOINT = "https://rustfs.s.ggss.club:50000"
DEPOT_LAN_ENDPOINT = "http://192.168.1.9:10000"


def depot_root(endpoint: str) -> str:
    return f"{endpoint.rstrip('/')}/{BUCKET}/{PREFIX}"


DEPOT_PUBLIC_URL = depot_root(DEPOT_PUBLIC_ENDPOINT)
DEPOT_LAN_URL = depot_root(DEPOT_LAN_ENDPOINT)

# dist 本地文件名 → S3 键（相对 PREFIX）
BUNDLE_FILES: dict[str, dict[str, str]] = {
    "amd64": {
        "ha-payload-linux-amd64.tar.zst": "bundles/amd64/payload.tar.zst",
        "ha-worker-bundle-linux-amd64.tar.zst": "bundles/amd64/worker.tar.zst",
        "incus-offline-amd64.tar.zst": "bundles/amd64/incus-offline.tar.zst",
        "workspace-assets-amd64.tar.zst": "bundles/amd64/workspace-assets.tar.zst",
    },
    "arm64": {
        "ha-payload-linux-arm64.tar.zst": "bundles/arm64/payload.tar.zst",
        "ha-worker-bundle-linux-arm64.tar.zst": "bundles/arm64/worker.tar.zst",
        "incus-offline-arm64.tar.zst": "bundles/arm64/incus-offline.tar.zst",
        "workspace-assets-arm64.tar.zst": "bundles/arm64/workspace-assets.tar.zst",
    },
}

# go build 产出 → S3 键
BIN_FILES: dict[str, dict[str, str]] = {
    "amd64": {
        "ha-agent-linux-amd64": "bin/amd64/ha-agent",
        "ha-setup-linux-amd64": "bin/amd64/ha-setup",
        "ha-bastion-linux-amd64": "bin/amd64/ha-bastion",
        "easytier-core": "bin/amd64/easytier-core",
    },
    "arm64": {
        "ha-agent-linux-arm64": "bin/arm64/ha-agent",
        "ha-setup-linux-arm64": "bin/arm64/ha-setup",
        "ha-bastion-linux-arm64": "bin/arm64/ha-bastion",
        "easytier-core": "bin/arm64/easytier-core",
    },
}

EDGE_FILES: dict[str, Path] = {
    "edge/easytier/easytier.service": Path("deploy/easytier.service"),
    "edge/easytier/easytier-start.sh": Path("deploy/easytier-start.sh"),
    "edge/easytier/easytier.env.example": Path("deploy/easytier.env.example"),
    "edge/bastion/ha-bastion-sshd.service": Path("deploy/ha-bastion-sshd.service"),
    "edge/bastion/sshd-bastion.conf": Path("deploy/sshd-bastion.conf"),
    "edge/bastion/ha-auth-keys.sh": Path("deploy/ha-auth-keys.sh"),
    "edge/ingress/openresty-ha.conf": Path("deploy/openresty-ha.conf"),
    "edge/ingress/openresty-ingress.conf": Path("deploy/openresty-ingress.conf"),
    "edge/agent/ha-agent.service": Path("deploy/ha-agent.service"),
}

LAB_FILES = (
    "install.sh",
    "reinstall.sh",
    "worker-install.sh",
    "reset-worker.sh",
    "install-easytier.sh",
    "install-incus.sh",
    "install-incus-online.sh",
    "incus-offline.sh",
    "os-detect.sh",
    "ubuntu-apt-mirror.sh",
    "verify-worker.sh",
    "depot-paths.sh",
    "lab.defaults.env",
    "easytier-start.sh",
    "easytier.service",
    "MANIFEST.txt",
)

# workspace 在线安装单独上传（不必拉 incus-offline 大包）
WORKSPACE_IMAGE_KEYS: dict[str, str] = {
    "amd64": "bundles/amd64/images/ubuntu-24.04-server-cloudimg-amd64-root.tar.xz",
    "arm64": "bundles/arm64/images/ubuntu-24.04-server-cloudimg-arm64-root.tar.xz",
}


def public_base(endpoint: str, bucket: str = BUCKET) -> str:
    return f"{endpoint.rstrip('/')}/{bucket}/{PREFIX}"


def lab_key(name: str) -> str:
    return f"lab/{name}"


def bundle_url(base: str, arch: str, name: str) -> str:
    return f"{base.rstrip('/')}/bundles/{arch}/{name}"


def bin_url(base: str, arch: str, name: str) -> str:
    return f"{base.rstrip('/')}/bin/{arch}/{name}"


def _find_bin(root: Path, dist: Path, lab_src: Path, arch: str, local_name: str) -> Path | None:
    candidates = [dist / local_name, lab_src / local_name]
    if local_name.startswith("ha-agent"):
        candidates.append(dist / f"ha-agent-linux-{arch}")
        candidates.append(lab_src / f"ha-agent-linux-{arch}")
    if local_name.startswith("ha-setup"):
        candidates.append(dist / f"ha-setup-linux-{arch}")
    if local_name == "easytier-core":
        candidates.extend(
            [
                lab_src / "easytier-core",
                dist / f"payload-linux-{arch}" / "easytier" / "easytier-core",
                root / "packaging" / "cache" / arch / "easytier" / "easytier-core",
            ]
        )
    if local_name.startswith("ha-bastion"):
        candidates.append(dist / f"ha-bastion-linux-{arch}")
    for c in candidates:
        if c.is_file():
            return c
    return None


def collect_uploads(dist: Path, root: Path, lab_src: Path) -> list[tuple[Path, str, str | None]]:
    items: list[tuple[Path, str, str | None]] = []
    cache_root = root / "packaging" / "cache"

    install_sh = root / "packaging" / "install.sh"
    if install_sh.is_file():
        items.append((install_sh, "install.sh", "text/x-shellscript"))

    versions = dist / "VERSIONS.md"
    if versions.is_file():
        items.append((versions, "VERSIONS.md", "text/markdown"))

    for arch, mapping in BUNDLE_FILES.items():
        for local_name, key in mapping.items():
            for candidate in (dist / local_name, lab_src / local_name):
                if candidate.is_file():
                    items.append((candidate, key, None))
                    break

    for arch, mapping in BIN_FILES.items():
        for local_name, key in mapping.items():
            found = _find_bin(root, dist, lab_src, arch, local_name)
            if found and found.is_file():
                items.append((found, key, None))
            elif local_name == "easytier-core" and arch == "arm64":
                amd_et = cache_root / "amd64" / "easytier" / "easytier-core"
                if amd_et.is_file():
                    items.append((amd_et, key, None))

    for key, rel in EDGE_FILES.items():
        src = root / rel
        if src.is_file():
            ct = "text/x-shellscript" if src.suffix == ".sh" else None
            items.append((src, key, ct))

    if lab_src.is_dir():
        for name in LAB_FILES:
            p = lab_src / name
            if p.is_file():
                ct = "text/x-shellscript" if p.suffix == ".sh" else None
                items.append((p, lab_key(name), ct))

    for arch, key in WORKSPACE_IMAGE_KEYS.items():
        for candidate in (
            cache_root / arch / "images" / Path(key).name,
            dist / f"payload-linux-{arch}" / "images" / Path(key).name,
        ):
            if candidate.is_file():
                items.append((candidate, key, None))
                break

    return items


def generate_index(uploads: list[tuple[Path, str, str | None]], base_url: str) -> str:
    lines = [
        "# ha-cluster Depot 索引",
        "",
        f"> 生成于 {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · 布局见 `packaging/depot_layout.py`",
        "",
        f"**公网根** `{base_url}`",
        "",
        "| S3 键 | 大小 | 公网 URL |",
        "|-------|------|----------|",
    ]
    for local, key, _ in sorted(uploads, key=lambda x: x[1]):
        mib = local.stat().st_size / (1024 * 1024)
        size = f"{mib:.2f} MiB" if mib >= 0.01 else f"{local.stat().st_size} B"
        url = f"{base_url}/{key}"
        lines.append(f"| `{key}` | {size} | {url} |")
    lines.append("")
    return "\n".join(lines)


def build_mirror_tree(mirror_root: Path, dist: Path, root: Path, lab_src: Path) -> list[tuple[Path, str, str | None]]:
    import shutil

    if mirror_root.exists():
        shutil.rmtree(mirror_root)
    mirror_root.mkdir(parents=True)
    uploads = collect_uploads(dist, root, lab_src)
    for local, key, _ct in uploads:
        dest = mirror_root / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local, dest)
    return uploads
