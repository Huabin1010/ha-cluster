#!/usr/bin/env bash
# T4 · Build a self-contained worker bundle for deterministic one-click install.
# Does NOT rewrite packaging/pack.sh (T3). Optionally copies from packaging/cache/ when present.
#
# Usage:
#   bash deploy/t4/build-worker-bundle.sh amd64
#   bash deploy/t4/build-worker-bundle.sh arm64
#
# Image strategy (both shipped when possible):
#   1) docker save ubuntu:24.04  → images/ubuntu-24.04.docker.tar  (scp-friendly; install converts)
#   2) incus image export        → images/ha-ubuntu-24.04.tar.gz   (preferred on Incus workers)
#   3) packaging/cache cloud rootfs if present (import fallback)
#
# Env:
#   SUDO_PASSWORD   non-interactive sudo
#   HA_DOCKER_IMAGE override docker image (default ubuntu:24.04)
#   HA_BUNDLE_INCLUDE_K3S=0|1   default 1 if cache has k3s
#   HA_BUNDLE_INCLUDE_ET=0|1    default 1 if cache has easytier-core
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.local/go/bin:${HOME}/go/bin:/usr/local/go/bin:${PATH}"

ARCH="${1:-}"
if [[ "${ARCH}" != "amd64" && "${ARCH}" != "arm64" ]]; then
  echo "usage: $0 <amd64|arm64>" >&2
  exit 2
fi

DOCKER_IMAGE="${HA_DOCKER_IMAGE:-ubuntu:24.04}"
OUT="${ROOT}/dist/worker-bundle-linux-${ARCH}"
CACHE="${ROOT}/packaging/cache/${ARCH}"
BUNDLE_VER="${HA_BUNDLE_VERSION:-0.1.0}"

sudo_auth() {
  if sudo -n true 2>/dev/null; then return 0; fi
  if [[ -n "${SUDO_PASSWORD:-}" ]]; then
    echo "${SUDO_PASSWORD}" | sudo -S -v
    return $?
  fi
  sudo -v
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need go
need docker
need sha256sum
need python3
need tar
need zstd

rm -rf "${OUT}"
mkdir -p \
  "${OUT}/bin" \
  "${OUT}/images" \
  "${OUT}/deploy" \
  "${OUT}/k3s" \
  "${OUT}/easytier" \
  "${OUT}/debs"

echo "==> build ha-agent / ha-setup (${ARCH})"
CGO_ENABLED=0 GOOS=linux GOARCH="${ARCH}" go build -trimpath -ldflags="-s -w" \
  -o "${OUT}/bin/ha-agent" "${ROOT}/cmd/ha-agent"
CGO_ENABLED=0 GOOS=linux GOARCH="${ARCH}" go build -trimpath -ldflags="-s -w" \
  -o "${OUT}/bin/ha-setup" "${ROOT}/cmd/ha-setup"
cp -f "${OUT}/bin/ha-agent" "${OUT}/ha-agent"
cp -f "${OUT}/bin/ha-setup" "${OUT}/ha-setup"
chmod +x "${OUT}/ha-agent" "${OUT}/ha-setup"

cp -f "${ROOT}/deploy/ha-agent.service" "${OUT}/deploy/ha-agent.service"
cp -f "${ROOT}/deploy/t4/install-worker.sh" "${OUT}/deploy/install-worker.sh"
chmod +x "${OUT}/deploy/install-worker.sh"

echo "${ARCH}" > "${OUT}/ARCH"

# --- images ---
echo "==> workspace image (docker save ${DOCKER_IMAGE}) — same-arch only"
host_arch="$(uname -m)"
case "${host_arch}" in
  x86_64) host_arch=amd64 ;;
  aarch64) host_arch=arm64 ;;
esac

if [[ "${ARCH}" == "${host_arch}" ]]; then
  if ! docker image inspect "${DOCKER_IMAGE}" >/dev/null 2>&1; then
    echo "  pulling ${DOCKER_IMAGE}"
    docker pull --platform "linux/${ARCH}" "${DOCKER_IMAGE}"
  fi
  # Refuse to ship wrong-arch docker tar
  darch="$(docker image inspect "${DOCKER_IMAGE}" --format '{{.Architecture}}')"
  [[ "${darch}" == "x86_64" ]] && darch=amd64
  [[ "${darch}" == "aarch64" ]] && darch=arm64
  if [[ "${darch}" != "${ARCH}" ]]; then
    echo "error: local ${DOCKER_IMAGE} is ${darch}, want ${ARCH}. Pull with --platform linux/${ARCH} first." >&2
    exit 1
  fi
  docker save "${DOCKER_IMAGE}" -o "${OUT}/images/ubuntu-24.04.docker.tar"
  echo "  wrote images/ubuntu-24.04.docker.tar ($(du -h "${OUT}/images/ubuntu-24.04.docker.tar" | awk '{print $1}')) arch=${darch}"
else
  echo "  skip docker save on cross-arch build (host=${host_arch} target=${ARCH})"
  echo "  Incus workers use cloud rootfs / packaging/cache images; docker.tar is optional same-arch transfer"
fi

# Prefer exporting already-imported Incus image on matching arch (Path A proven).
if [[ "${ARCH}" == "${host_arch}" ]] && command -v incus >/dev/null 2>&1; then
  sudo_auth || true
  if sudo -n true 2>/dev/null || [[ -n "${SUDO_PASSWORD:-}" ]]; then
    [[ -n "${SUDO_PASSWORD:-}" ]] && echo "${SUDO_PASSWORD}" | sudo -S -v >/dev/null
    fp="$(sudo incus image list --format json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["fingerprint"] if d else "")' || true)"
    if [[ -n "${fp}" ]]; then
      echo "==> incus image export ${fp}"
      rm -f "${OUT}/images/ha-ubuntu-24.04" "${OUT}/images/ha-ubuntu-24.04.root" \
        "${OUT}/images/ha-ubuntu-24.04.tar.gz" "${OUT}/images/ha-ubuntu-24.04.tar.xz"
      sudo incus image export "${fp}" "${OUT}/images/ha-ubuntu-24.04"
      sudo chown -R "$(id -u):$(id -g)" "${OUT}/images" || true
      if [[ -f "${OUT}/images/ha-ubuntu-24.04" && -f "${OUT}/images/ha-ubuntu-24.04.root" ]]; then
        echo "  wrote images/ha-ubuntu-24.04 + .root ($(du -h "${OUT}/images/ha-ubuntu-24.04.root" | awk '{print $1}'))"
      else
        ls -la "${OUT}/images"/ha-ubuntu-24.04* 2>/dev/null || echo "  warn: unexpected export layout"
      fi
    else
      echo "  warn: no local Incus images to export"
    fi
  fi
fi

# Cloud rootfs from T3 cache (Incus import fallback)
rootfs="${CACHE}/images/ubuntu-24.04-server-cloudimg-${ARCH}-root.tar.xz"
if [[ -f "${rootfs}" ]]; then
  cp -f "${rootfs}" "${OUT}/images/"
  echo "  copied cloud rootfs from packaging/cache"
fi

# Optional k3s / easytier from cache (complete worker, still T4-owned bundle)
INCLUDE_K3S="${HA_BUNDLE_INCLUDE_K3S:-1}"
INCLUDE_ET="${HA_BUNDLE_INCLUDE_ET:-1}"

if [[ "${INCLUDE_K3S}" == "1" && -x "${CACHE}/k3s/k3s" ]]; then
  echo "==> include k3s from packaging/cache/${ARCH}"
  cp -f "${CACHE}/k3s/k3s" "${OUT}/k3s/k3s"
  chmod +x "${OUT}/k3s/k3s"
  [[ -f "${CACHE}/k3s/install.sh" ]] && cp -f "${CACHE}/k3s/install.sh" "${OUT}/k3s/install.sh" && chmod +x "${OUT}/k3s/install.sh"
  if [[ -f "${CACHE}/k3s/k3s-airgap-images-${ARCH}.tar.zst" ]]; then
    cp -f "${CACHE}/k3s/k3s-airgap-images-${ARCH}.tar.zst" "${OUT}/k3s/"
  fi
  # flat convenience copies expected by older install-worker.sh
  cp -f "${OUT}/k3s/k3s" "${OUT}/k3s-bin"
  [[ -f "${OUT}/k3s/install.sh" ]] && cp -f "${OUT}/k3s/install.sh" "${OUT}/install-k3s.sh"
  if [[ -f "${OUT}/k3s/k3s-airgap-images-${ARCH}.tar.zst" ]]; then
    cp -f "${OUT}/k3s/k3s-airgap-images-${ARCH}.tar.zst" "${OUT}/"
  fi
fi

if [[ "${INCLUDE_ET}" == "1" && -x "${CACHE}/easytier/easytier-core" ]]; then
  echo "==> include easytier from packaging/cache/${ARCH}"
  cp -f "${CACHE}/easytier/easytier-core" "${OUT}/easytier/easytier-core"
  chmod +x "${OUT}/easytier/easytier-core"
  cp -f "${OUT}/easytier/easytier-core" "${OUT}/easytier-core"
  if [[ -x "${CACHE}/easytier/easytier-cli" ]]; then
    cp -f "${CACHE}/easytier/easytier-cli" "${OUT}/easytier/easytier-cli"
    cp -f "${OUT}/easytier/easytier-cli" "${OUT}/easytier-cli"
  fi
fi

if compgen -G "${CACHE}/debs/*/*.deb" >/dev/null; then
  cp -a "${CACHE}/debs/." "${OUT}/debs/"
fi

# One-click installer (lives inside the bundle)
cp -f "${ROOT}/deploy/t4/bundle-install.sh" "${OUT}/install.sh"
chmod +x "${OUT}/install.sh"

echo "==> manifest.json + SHA256SUMS"
python3 - "${OUT}" "${ARCH}" "${BUNDLE_VER}" "${DOCKER_IMAGE}" <<'PY'
import hashlib, json, sys
from pathlib import Path

out, arch, ver, docker_image = sys.argv[1:5]
root = Path(out)

def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

components = []
sums = []
for path in sorted(root.rglob("*")):
    if not path.is_file():
        continue
    if path.name in {"manifest.json", "SHA256SUMS"}:
        continue
    rel = path.relative_to(root).as_posix()
    digest = sha256(path)
    components.append({"path": rel, "sha256": digest, "size": path.stat().st_size, "arch": arch})
    sums.append(f"{digest}  {rel}")

has = {c["path"] for c in components}
manifest = {
    "kind": "worker-bundle",
    "bundle_version": ver,
    "arch": arch,
    "os": "linux",
    "docker_image": docker_image,
    "incus_alias": "ha-ubuntu-24.04",
    "components": components,
    "notes": [
        "One-click: sudo ./install.sh --token 'ha://join/...' --fabric-ip 10.88.0.x --name NODE --power mains|battery --class desktop|phone",
        "Refuse if uname arch ≠ manifest.arch",
        "Prefer images/ha-ubuntu-24.04*.tar.* for Incus import; else convert docker save via docker export",
        "Transfer: scp -r worker-bundle-linux-<arch> root@host:/var/cache/ || scp ha-worker-bundle-linux-<arch>.tar.zst ...",
    ],
    "required": ["ha-agent", "ha-setup", "install.sh", "manifest.json"],
    "present": {
        "ha_agent": "ha-agent" in has,
        "ha_setup": "ha-setup" in has,
        "docker_tar": "images/ubuntu-24.04.docker.tar" in has,
        "incus_export": Path(out, "images/ha-ubuntu-24.04").is_file() and Path(out, "images/ha-ubuntu-24.04.root").is_file()
            or any(p.startswith("images/ha-ubuntu-24.04.tar") for p in has),
        "cloud_rootfs": any("cloudimg" in p for p in has),
        "k3s": "k3s/k3s" in has or "k3s" in has,
        "easytier": "easytier-core" in has or "easytier/easytier-core" in has,
    },
}
(root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
(root / "SHA256SUMS").write_text("\n".join(sums) + "\n")
print(f"  components={len(components)}")
print(f"  present={manifest['present']}")
missing = [r for r in manifest["required"] if r not in has and r != "manifest.json"]
if missing:
    raise SystemExit(f"bundle incomplete, missing: {missing}")
if not manifest["present"]["docker_tar"] and not manifest["present"]["incus_export"] and not manifest["present"]["cloud_rootfs"]:
    raise SystemExit("bundle has no workspace image (docker/incus/cloud)")
PY

(
  cd "${OUT}"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum | sed 's|^\([0-9a-f]*  \)\./|\1|' > SHA256SUMS
)

echo "==> compress"
ZSTD_OUT="${ROOT}/dist/ha-worker-bundle-linux-${ARCH}.tar.zst"
mkdir -p "${ROOT}/dist"
tar -C "${ROOT}/dist" -I 'zstd -T0 -10' -cf "${ZSTD_OUT}" "worker-bundle-linux-${ARCH}"
echo "wrote ${OUT}"
echo "wrote ${ZSTD_OUT} ($(du -h "${ZSTD_OUT}" | awk '{print $1}'))"
echo
echo "Deploy:"
echo "  scp ${ZSTD_OUT} root@<host>:/tmp/"
echo "  ssh root@<host> 'cd /var/cache && tar -I zstd -xf /tmp/ha-worker-bundle-linux-${ARCH}.tar.zst'"
echo "  ssh root@<host> 'cd /var/cache/worker-bundle-linux-${ARCH} && ./install.sh --token ... --fabric-ip ... --name ...'"
