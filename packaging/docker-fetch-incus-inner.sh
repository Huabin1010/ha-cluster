#!/usr/bin/env bash
# Runs inside ubuntu:<suite> container — invoked by fetch-incus.sh
set -euxo pipefail

SUITE="${1:?suite}"
ZABBLY_ARCH="${2:?arch}"
OUT="${3:-/out}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates apt-utils dpkg-dev

mkdir -p /etc/apt/keyrings "${OUT}"
curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc
cat >/etc/apt/sources.list.d/zabbly-incus-stable.sources <<EOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: ${SUITE}
Components: main
Architectures: ${ZABBLY_ARCH}
Signed-By: /etc/apt/keyrings/zabbly.asc
EOF
apt-get update -qq

apt-get install -y -qq --download-only incus
cp -a /var/cache/apt/archives/*.deb "${OUT}/" 2>/dev/null || true

parse_exact_dep() {
  local spec="$1" name ver
  case "${spec}" in
    *"(="*)")
      name="${spec%% (*}"
      ver="${spec#*(= }"
      ver="${ver%)}"
      ver="${ver#"${ver%%[![:space:]]*}"}"
      ver="${ver%"${ver##*[![:space:]]}"}"
      name="${name#"${name%%[![:space:]]*}"}"
      name="${name%"${name##*[![:space:]]}"}"
      [[ -n "${name}" && -n "${ver}" ]] || return 1
      printf '%s=%s\n' "${name}" "${ver}"
      ;;
    *)
      return 1
      ;;
  esac
}

close_exact_deps() {
  local round=0 missing=0 name ver spec pkg
  while (( round < 25 )); do
    missing=0
    for deb in "${OUT}"/*.deb; do
      [[ -f "${deb}" ]] || continue
      while read -r spec; do
        [[ -n "${spec}" ]] || continue
        spec="${spec#"${spec%%[![:space:]]*}"}"
        spec="${spec%"${spec##*[![:space:]]}"}"
        [[ -n "${spec}" ]] || continue
        if pkg="$(parse_exact_dep "${spec}")"; then
          name="${pkg%%=*}"
          ver="${pkg#*=}"
          if ! compgen -G "${OUT}/${name}_${ver}_*.deb" >/dev/null \
            && ! compgen -G "${OUT}/${name}_*_${ver}_*.deb" >/dev/null; then
            if apt-get download "${name}=${ver}" -o Dir::Cache::archives="${OUT}" 2>/dev/null; then
              missing=1
            fi
          fi
        fi
      done < <(dpkg-deb -f "${deb}" Depends Pre-Depends 2>/dev/null | tr "," "\n")
    done
    (( round++ ))
    [[ "${missing}" -eq 0 ]] && break
  done
}

close_exact_deps

mapfile -t SIM_PKGS < <(apt-get -s install -y incus 2>/dev/null | awk '/^Inst / {gsub(/[][]/,"",$3); print $2"="$3}')
if ((${#SIM_PKGS[@]} > 0)); then
  apt-get install -y -qq --download-only "${SIM_PKGS[@]}" || true
  cp -a /var/cache/apt/archives/*.deb "${OUT}/" 2>/dev/null || true
  close_exact_deps
fi

echo "debs: $(find "${OUT}" -maxdepth 1 -name '*.deb' | wc -l)"
find "${OUT}" -maxdepth 1 \( -name 'libsystemd0*.deb' -o -name 'libattr1*.deb' -o -name 'libgnutls30*.deb' \) 2>/dev/null | head -5 || true
