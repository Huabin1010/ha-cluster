#!/usr/bin/env bash
# Build arch-specific offline payload under dist/payload-linux-<arch>/.
# Usage: bash packaging/pack.sh <amd64|arm64>
# Requires: packaging/fetch-deps.sh already populated packaging/cache/<arch>/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=versions.env
source "${ROOT}/packaging/versions.env"

export PATH="${HOME}/go/bin:${HOME}/.local/go/bin:/usr/local/go/bin:${PATH}"

ARCH="${1:-}"
if [[ "${ARCH}" != "amd64" && "${ARCH}" != "arm64" ]]; then
  echo "usage: $0 <amd64|arm64>" >&2
  exit 2
fi

CACHE="${ROOT}/packaging/cache/${ARCH}"
OUT="${ROOT}/dist/payload-linux-${ARCH}"
DIST="${ROOT}/dist"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing command: $1" >&2
    exit 1
  }
}

need_cmd go
need_cmd python3
need_cmd sha256sum
need_cmd find
need_cmd cp

missing=()
require_file() {
  local rel="$1"
  if [[ ! -f "${CACHE}/${rel}" || ! -s "${CACHE}/${rel}" ]]; then
    missing+=("packaging/cache/${ARCH}/${rel}")
  fi
}

require_file "k3s/k3s"
require_file "k3s/k3s-airgap-images-${ARCH}.tar.zst"
require_file "k3s/install.sh"
require_file "easytier/easytier-core"

cloud_arch="${ARCH}"
rootfs_name="ubuntu-${UBUNTU_CLOUD_SERIES}-server-cloudimg-${cloud_arch}-root.tar.xz"
require_file "images/${rootfs_name}"

# At least one deb per suite
for suite in ${DEB_SUITES}; do
  if ! compgen -G "${CACHE}/debs/${suite}/*.deb" >/dev/null; then
    missing+=("packaging/cache/${ARCH}/debs/${suite}/*.deb")
  fi
done

if ((${#missing[@]} > 0)); then
  echo "error: missing required cache files for ${ARCH}:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "hint: run: bash packaging/fetch-deps.sh ${ARCH}" >&2
  exit 1
fi

rm -rf "${OUT}"
mkdir -p \
  "${OUT}/bin" \
  "${OUT}/k3s" \
  "${OUT}/easytier" \
  "${OUT}/images" \
  "${OUT}/debs"

echo "==> build ha-agent / ha-setup (${ARCH})"
CGO_ENABLED=0 GOOS=linux GOARCH="${ARCH}" go build -trimpath -ldflags="-s -w" \
  -o "${OUT}/bin/ha-agent" "${ROOT}/cmd/ha-agent"
CGO_ENABLED=0 GOOS=linux GOARCH="${ARCH}" go build -trimpath -ldflags="-s -w" \
  -o "${OUT}/bin/ha-setup" "${ROOT}/cmd/ha-setup"

# Convenience copies at payload root (installers often expect flat names).
cp -f "${OUT}/bin/ha-agent" "${OUT}/ha-agent"
cp -f "${OUT}/bin/ha-setup" "${OUT}/ha-setup"

echo "==> copy third-party (${ARCH})"
cp -f "${CACHE}/k3s/k3s" "${OUT}/k3s/k3s"
chmod +x "${OUT}/k3s/k3s"
cp -f "${CACHE}/k3s/k3s-airgap-images-${ARCH}.tar.zst" \
  "${OUT}/k3s/k3s-airgap-images-${ARCH}.tar.zst"
cp -f "${CACHE}/k3s/install.sh" "${OUT}/k3s/install.sh"
chmod +x "${OUT}/k3s/install.sh"

cp -f "${CACHE}/easytier/easytier-core" "${OUT}/easytier/easytier-core"
chmod +x "${OUT}/easytier/easytier-core"
if [[ -f "${CACHE}/easytier/easytier-cli" ]]; then
  cp -f "${CACHE}/easytier/easytier-cli" "${OUT}/easytier/easytier-cli"
  chmod +x "${OUT}/easytier/easytier-cli"
fi

cp -f "${CACHE}/images/${rootfs_name}" "${OUT}/images/${rootfs_name}"

for suite in ${DEB_SUITES}; do
  mkdir -p "${OUT}/debs/${suite}"
  cp -f "${CACHE}/debs/${suite}/"*.deb "${OUT}/debs/${suite}/"
done

# Record intended arch next to binaries so T4 can refuse a wrong-arch payload
# even if a human copies files across directories.
cat > "${OUT}/ARCH" <<EOF
${ARCH}
EOF

echo "==> manifest.json + SHA256SUMS"
GIT_COMMIT_FULL="uncommitted"
if git -C "${ROOT}" rev-parse HEAD >/dev/null 2>&1; then
  GIT_COMMIT_FULL="$(git -C "${ROOT}" rev-parse HEAD)"
fi
python3 - "${OUT}" "${ARCH}" "${PAYLOAD_VERSION}" "${K3S_VERSION}" "${EASYTIER_VERSION}" \
  "${UBUNTU_CLOUD_SERIES}" "${UBUNTU_CLOUD_CODENAME}" "${GIT_COMMIT_FULL}" <<'PY'
import hashlib, json, os, sys
from pathlib import Path

out, arch, payload_ver, k3s_ver, et_ver, ubuntu_series, ubuntu_codename, git_commit = sys.argv[1:9]
root = Path(out)

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

skip_names = {"manifest.json", "SHA256SUMS"}
components = []
sums_lines = []
for path in sorted(root.rglob("*")):
    if not path.is_file():
        continue
    rel = path.relative_to(root).as_posix()
    if path.name in skip_names:
        continue
    digest = sha256(path)
    size = path.stat().st_size
    components.append({
        "path": rel,
        "sha256": digest,
        "size": size,
        "arch": arch,
    })
    sums_lines.append(f"{digest}  {rel}")

manifest = {
    "payload_version": payload_ver,
    "arch": arch,
    "os": "linux",
    "git_commit": git_commit,
    "compatible_os": [
        {"id": "ubuntu", "version": "22.04", "codename": "jammy"},
        {"id": "ubuntu", "version": "24.04", "codename": "noble"},
        {"id": "ubuntu", "version": "26.04", "codename": "resolute"},
    ],
    "versions": {
        "k3s": k3s_ver,
        "k3s_airgap": f"k3s-airgap-images-{arch}.tar.zst",
        "easytier": et_ver,
        "ubuntu_cloud_rootfs": f"ubuntu-{ubuntu_series}-server-cloudimg-{arch}-root.tar.xz",
        "ubuntu_incus_alias_hint": f"ubuntu/{ubuntu_series} (images:ubuntu/{ubuntu_series}/cloud)",
        "ha_agent": payload_ver,
        "ha_setup": payload_ver,
        "ha_git_commit": git_commit,
    },
    "components": components,
    "notes": [
        "Refuse install if uname -m arch does not match manifest.arch (amd64↔x86_64, arm64↔aarch64).",
        "k3s airgap: place images under /var/lib/rancher/k3s/agent/images/ then INSTALL_K3S_SKIP_DOWNLOAD=true.",
        "Import images/<ubuntu-*-root.tar.xz> into Incus (or use as rootfs source) on the worker (T4).",
        "debs/jammy for Ubuntu 22.04 hosts; debs/resolute for Ubuntu 26.04 phones.",
    ],
}

(root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8")
(root / "SHA256SUMS").write_text("\n".join(sums_lines) + "\n", encoding="utf-8")
print(f"  components: {len(components)}")
PY

# Refresh SHA256SUMS to include manifest itself (optional but useful for Depot consumers).
(
  cd "${OUT}"
  # Recompute full tree including manifest.json
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum | sed 's|^\([0-9a-f]*  \)\\./|\1|' > SHA256SUMS
)

mkdir -p "${DIST}"
# Human-readable freeze list (T3 owns this file). Regenerated each pack of either arch.
write_versions_md() {
  local amd_dir="${DIST}/payload-linux-amd64"
  local arm_dir="${DIST}/payload-linux-arm64"
  local amd_size="(not built)"
  local arm_size="(not built)"
  local amd_zst="(not built)"
  local arm_zst="(not built)"
  [[ -d "${amd_dir}" ]] && amd_size="$(du -sh "${amd_dir}" | awk '{print $1}')"
  [[ -d "${arm_dir}" ]] && arm_size="$(du -sh "${arm_dir}" | awk '{print $1}')"
  [[ -f "${DIST}/ha-payload-linux-amd64.tar.zst" ]] && amd_zst="$(du -sh "${DIST}/ha-payload-linux-amd64.tar.zst" | awk '{print $1}')"
  [[ -f "${DIST}/ha-payload-linux-arm64.tar.zst" ]] && arm_zst="$(du -sh "${DIST}/ha-payload-linux-arm64.tar.zst" | awk '{print $1}')"
  local git_commit="uncommitted"
  if git -C "${ROOT}" rev-parse HEAD >/dev/null 2>&1; then
    git_commit="$(git -C "${ROOT}" rev-parse HEAD)"
  fi
  local host
  host="$(hostname -s 2>/dev/null || hostname)"

  cat > "${DIST}/VERSIONS.md" <<EOF
# Payload frozen versions (T3)

> Generated by \`packaging/pack.sh\`. Do not edit by hand for release; change \`packaging/versions.env\` and re-fetch/pack.

| Component | Version / artifact |
|-----------|-------------------|
| payload | ${PAYLOAD_VERSION} |
| k3s | ${K3S_VERSION} |
| k3s airgap amd64 | \`k3s-airgap-images-amd64.tar.zst\` |
| k3s airgap arm64 | \`k3s-airgap-images-arm64.tar.zst\` |
| easytier-core | ${EASYTIER_VERSION} |
| Ubuntu cloud rootfs | ${UBUNTU_CLOUD_SERIES} (${UBUNTU_CLOUD_CODENAME}) \`ubuntu-${UBUNTU_CLOUD_SERIES}-server-cloudimg-<arch>-root.tar.xz\` |
| Incus alias hint | \`ubuntu/${UBUNTU_CLOUD_SERIES}\` / \`images:ubuntu/${UBUNTU_CLOUD_SERIES}/cloud\` |
| host debs | ${DEB_PACKAGES} for suites: ${DEB_SUITES} (\`jammy\`=22.04, \`resolute\`=26.04) |
| ha-agent / ha-setup | git commit \`${git_commit}\` |

## Where the packages live

| Item | Path |
|------|------|
| Host | \`${host}\` (dev-pc) |
| Payload trees | \`${DIST}/payload-linux-{amd64,arm64}/\` |
| zstd archives | \`${DIST}/ha-payload-linux-{amd64,arm64}.tar.zst\` |
| Upstream cache | \`${ROOT}/packaging/cache/{amd64,arm64}/\` |
| Depot | \`http://127.0.0.1:9090/\` via \`bash packaging/depot.sh\` |

\`dist/\` is gitignored — copy from this machine or rebuild with the commands below.

## Directory sizes

| Arch | \`dist/payload-linux-*\` | \`ha-payload-linux-*.tar.zst\` |
|------|---------------------------|--------------------------------|
| amd64 | ${amd_size} | ${amd_zst} |
| arm64 | ${arm_size} | ${arm_zst} |

Arm64 target: **≤ 800 MiB** for the \`.tar.zst\` archive. If exceeded, primary cause is k3s airgap + Ubuntu cloud rootfs (already xz/zst compressed; re-packing barely shrinks them).

## How to rebuild

\`\`\`bash
bash packaging/fetch-deps.sh all   # needs network
bash packaging/pack.sh amd64
bash packaging/pack.sh arm64
bash packaging/depot.sh            # serve http://127.0.0.1:9090/
\`\`\`

## Arch guard (for T4)

Each payload contains:

- \`manifest.json\` → \`"arch":"<amd64|arm64>"\` on every component + top-level \`arch\`
- \`ARCH\` file with the same value

\`ha-setup\` / worker install **must** refuse when host arch ≠ manifest arch.
EOF
}

echo "==> compress tar.zst"
need_cmd tar
if command -v zstd >/dev/null 2>&1; then
  ZSTD_OUT="${DIST}/ha-payload-linux-${ARCH}.tar.zst"
  # Content is mostly already compressed (airgap zst + rootfs xz); light zstd is enough.
  tar -C "${DIST}" -I 'zstd -T0 -3' -cf "${ZSTD_OUT}" "payload-linux-${ARCH}"
  echo "  wrote ${ZSTD_OUT} ($(du -h "${ZSTD_OUT}" | awk '{print $1}'))"
else
  echo "  warn: zstd not installed; skip ha-payload-linux-${ARCH}.tar.zst" >&2
fi

write_versions_md

# Size advisory for arm64
if [[ "${ARCH}" == "arm64" && -f "${DIST}/ha-payload-linux-arm64.tar.zst" ]]; then
  bytes="$(stat -c%s "${DIST}/ha-payload-linux-arm64.tar.zst")"
  limit=$((800 * 1024 * 1024))
  if (( bytes > limit )); then
    echo "warn: arm64 tar.zst is $((bytes / 1024 / 1024))MiB > 800MiB — recorded in dist/VERSIONS.md" >&2
  fi
fi

echo "wrote ${OUT}"
