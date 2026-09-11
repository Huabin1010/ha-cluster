#!/usr/bin/env bash
# Offline Incus + ha-ubuntu-24.04 image import (Depot / STAGING bundle only).
# Bundle layout:
#   debs/*.deb
#   images/ubuntu-*-root.tar.xz
set -euo pipefail

ha_incus_machine_arch() {
  case "$(dpkg --print-architecture 2>/dev/null || uname -m)" in
    amd64 | x86_64) echo "x86_64" ;;
    arm64 | aarch64) echo "aarch64" ;;
    *) echo "x86_64" ;;
  esac
}

ha_incus_profile_ok() {
  incus profile show default 2>/dev/null | grep -q 'type: disk' \
    && incus profile show default 2>/dev/null | grep -q 'type: nic'
}

ha_incus_ensure_profile() {
  if ha_incus_profile_ok; then
    return 0
  fi
  echo "==> repair incus profile (root disk + NIC)"
  if ! incus storage list -c n --format csv 2>/dev/null | grep -qx 'default'; then
    incus storage create default dir
  fi
  if ! incus network list -c n --format csv 2>/dev/null | grep -qx 'incusbr0'; then
    incus network create incusbr0 \
      ipv4.address=10.137.105.1/24 ipv4.nat=true ipv6.address=none
  fi
  if ! incus profile show default 2>/dev/null | grep -q 'type: disk'; then
    incus profile device add default root disk path=/ pool=default
  fi
  if ! incus profile show default 2>/dev/null | grep -q 'type: nic'; then
    incus profile device add default eth0 nic network=incusbr0 name=eth0
  fi
}

ha_incus_init() {
  if incus info >/dev/null 2>&1 && ha_incus_profile_ok; then
    return 0
  fi
  cat >/tmp/ha-incus-preseed.yaml <<'EOF'
config: {}
networks:
- config:
    ipv4.address: 10.137.105.1/24
    ipv4.nat: "true"
    ipv6.address: none
  name: incusbr0
  type: bridge
storage_pools:
- config: {}
  name: default
  driver: dir
profiles:
- name: default
  devices:
    eth0:
      name: eth0
      network: incusbr0
      type: nic
    root:
      path: /
      pool: default
      type: disk
EOF
  if ! incus info >/dev/null 2>&1; then
    incus admin init --preseed </tmp/ha-incus-preseed.yaml
  fi
  ha_incus_ensure_profile
}

ha_incus_host_suite() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${VERSION_CODENAME:-}" in
      jammy | noble | resolute) echo "${VERSION_CODENAME}"; return 0 ;;
    esac
  fi
  echo "jammy"
}

ha_incus_resolve_debs_dir() {
  local bundle_dir="$1"
  local suite
  suite="$(ha_incus_host_suite)"
  if [[ -d "${bundle_dir}/debs/${suite}" ]] && compgen -G "${bundle_dir}/debs/${suite}/*.deb" >/dev/null; then
    echo "${bundle_dir}/debs/${suite}"
    return 0
  fi
  if compgen -G "${bundle_dir}/debs/*.deb" >/dev/null; then
    echo "${bundle_dir}/debs"
    return 0
  fi
  return 1
}

ha_incus_apt_preflight() {
  export DEBIAN_FRONTEND=noninteractive
  dpkg --configure -a 2>/dev/null || true
  apt-get -f install -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold 2>/dev/null || true
}

ha_incus_install_debs() {
  local bundle_dir="$1"
  local deb_dir suite
  if command -v incus >/dev/null 2>&1 && incus version >/dev/null 2>&1; then
    return 0
  fi
  if ! deb_dir="$(ha_incus_resolve_debs_dir "${bundle_dir}")"; then
    echo "error: no incus debs for suite $(ha_incus_host_suite) under ${bundle_dir}/debs" >&2
    return 1
  fi
  suite="$(ha_incus_host_suite)"
  ha_incus_apt_preflight

  local count
  count="$(find "${deb_dir}" -maxdepth 1 -name '*.deb' | wc -l)"
  echo "==> install incus from ${deb_dir} (${count} debs, suite=${suite})"

  if ! command -v dpkg-scanpackages >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq apt-utils dpkg-dev 2>/dev/null || true
  fi

  (
    cd "${deb_dir}"
    dpkg-scanpackages . /dev/null | gzip -9c >Packages.gz
  )

  local list="/etc/apt/sources.list.d/ha-incus-offline.list"
  echo "deb [trusted=yes] file:${deb_dir} ./" >"${list}"
  apt-get update -qq

  if ! DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    -o Dir::Etc::sourcelist="${list}" \
    -o Dir::Etc::sourceparts=- \
    -o APT::Get::List-Cleanup=0 \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold \
    --allow-downgrades \
    incus; then
    echo "warn: apt local-repo install failed, retry dpkg" >&2
    dpkg -i "${deb_dir}"/*.deb 2>/dev/null || true
    DEBIAN_FRONTEND=noninteractive apt-get -f install -y -qq \
      -o Dpkg::Options::=--force-confdef \
      -o Dpkg::Options::=--force-confold \
      --allow-downgrades || true
  fi

  rm -f "${list}"
  apt-get update -qq 2>/dev/null || true

  if ! command -v incus >/dev/null 2>&1; then
    echo "error: incus binary missing after offline install (suite=${suite})" >&2
    dpkg -l incus 2>/dev/null | tail -3 >&2 || true
    return 1
  fi
  systemctl enable --now incus 2>/dev/null || true
  command -v incus >/dev/null 2>&1
}

ha_incus_import_image() {
  local bundle_dir="$1"
  local alias="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
  local machine
  machine="$(ha_incus_machine_arch)"

  if incus image list -c l --format csv 2>/dev/null | grep -qx "${alias}"; then
    echo "incus alias ${alias} already present"
    return 0
  fi

  local rootfs
  rootfs="$(ls -1 "${bundle_dir}"/images/ubuntu-*-root.tar.xz 2>/dev/null | head -1 || true)"
  if [[ -z "${rootfs}" ]]; then
    echo "error: no ubuntu cloud rootfs in ${bundle_dir}/images" >&2
    return 1
  fi

  echo "==> incus image import ${rootfs} → ${alias}"
  local tmp
  tmp="$(mktemp -d)"
  cat >"${tmp}/metadata.yaml" <<EOF
architecture: ${machine}
creation_date: $(date +%s)
properties:
  description: ha-cluster ubuntu cloud rootfs (offline)
  os: ubuntu
  release: "24.04"
EOF
  tar -C "${tmp}" -cf "${tmp}/meta.tar" metadata.yaml
  incus image import "${tmp}/meta.tar" "${rootfs}" --alias "${alias}"
  rm -rf "${tmp}"
}

# Download + extract incus offline bundle（URL 由 depot-paths ha_bundle_url 提供）
ha_incus_prepare_bundle() {
  local bundle_url="$1"
  local workdir="${2:-/tmp/ha-incus-offline}"

  mkdir -p "${workdir}"
  if compgen -G "${workdir}/images/ubuntu-*-root.tar.xz" >/dev/null; then
    return 0
  fi
  if [[ -d "${workdir}/workspace-debs" ]] && compgen -G "${workdir}/workspace-debs/*.deb" >/dev/null; then
    local suite deb_ok=0
    suite="$(ha_incus_host_suite)"
    if compgen -G "${workdir}/debs/${suite}/*.deb" >/dev/null \
      || compgen -G "${workdir}/debs/*.deb" >/dev/null; then
      deb_ok=1
    fi
    if [[ "${deb_ok}" -eq 1 ]]; then
      return 0
    fi
  fi

  echo "==> fetch ${bundle_url}"
  rm -rf "${workdir}"
  mkdir -p "${workdir}"
  if command -v zstd >/dev/null 2>&1; then
    curl --connect-timeout 15 --max-time 0 -fsSL "${bundle_url}" | zstd -d -q | tar -xf - -C "${workdir}"
  else
    local tmp="${workdir}/bundle.tar.zst"
    curl --connect-timeout 15 --max-time 0 -fsSL "${bundle_url}" -o "${tmp}"
    tar -I zstd -xf "${tmp}" -C "${workdir}"
    rm -f "${tmp}"
  fi
}

ha_incus_network_fixup() {
  local fixup="${HA_INCUS_NETWORK_SCRIPT:-/usr/local/libexec/ha-cluster/incus-network-fixup.sh}"
  if [[ -x "${fixup}" ]]; then
    "${fixup}"
  else
    local bridge="${HA_INCUS_BRIDGE:-incusbr0}"
    if command -v iptables >/dev/null 2>&1; then
      iptables -C FORWARD -i "${bridge}" -j ACCEPT 2>/dev/null \
        || iptables -I FORWARD -i "${bridge}" -j ACCEPT
      iptables -C FORWARD -o "${bridge}" -j ACCEPT 2>/dev/null \
        || iptables -I FORWARD -o "${bridge}" -j ACCEPT
    fi
  fi
}

ha_incus_network_persist() {
  mkdir -p /usr/local/libexec/ha-cluster
  if [[ ! -x /usr/local/libexec/ha-cluster/incus-network-fixup.sh ]]; then
    cat >/usr/local/libexec/ha-cluster/incus-network-fixup.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
BRIDGE="${HA_INCUS_BRIDGE:-incusbr0}"
command -v iptables >/dev/null 2>&1 || exit 0
iptables -C FORWARD -i "${BRIDGE}" -j ACCEPT 2>/dev/null || iptables -I FORWARD -i "${BRIDGE}" -j ACCEPT
iptables -C FORWARD -o "${BRIDGE}" -j ACCEPT 2>/dev/null || iptables -I FORWARD -o "${BRIDGE}" -j ACCEPT
SCRIPT
    chmod 0755 /usr/local/libexec/ha-cluster/incus-network-fixup.sh
  fi
  cat >/etc/systemd/system/ha-incus-network.service <<'EOF'
[Unit]
Description=Allow Incus bridge forwarding (coexist with Docker)
After=network-online.target docker.service incus.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/libexec/ha-cluster/incus-network-fixup.sh

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now ha-incus-network.service
}

ha_incus_install_workspace_debs_host() {
  local bundle_dir="$1"
  local dest="/var/lib/ha-cluster/workspace-debs"
  if [[ -d "${bundle_dir}/workspace-debs" ]] \
    && compgen -G "${bundle_dir}/workspace-debs/*.deb" >/dev/null; then
    mkdir -p "${dest}"
    cp -af "${bundle_dir}/workspace-debs/"*.deb "${dest}/"
    echo "==> workspace docker debs → ${dest} ($(find "${dest}" -name '*.deb' | wc -l) packages)"
  else
    echo "warn: no workspace-debs in bundle (workspace docker will need online apt)" >&2
  fi
}

# 把 workspace-debs 里的 docker.io 一次性打进 ha-ubuntu-24.04（不走外网）。
# docker.service 保持 disabled，避免容器开机时 docker0 抢在 DHCP 前起来。
ha_incus_ensure_image_alias() {
  local alias="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
  if incus image list -c l --format csv 2>/dev/null | grep -qx "${alias}"; then
    return 0
  fi
  local fp
  fp="$(incus image list -c f --format csv 2>/dev/null | awk -F, '{print $1}' | head -1)"
  if [[ -z "${fp}" ]]; then
    echo "error: no incus images present to alias as ${alias}" >&2
    return 1
  fi
  echo "==> restore alias ${alias} → ${fp}"
  incus image alias create "${alias}" "${fp}"
}

ha_incus_image_has_docker() {
  [[ -f /var/lib/ha-cluster/workspace-image-docker ]] && \
    incus image list -c l --format csv 2>/dev/null | grep -qx "${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
}

ha_incus_bake_docker_image() {
  local alias="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
  local dest="/var/lib/ha-cluster/workspace-debs"
  if ! command -v incus >/dev/null 2>&1; then
    return 0
  fi
  ha_incus_ensure_image_alias
  if ! incus image list -c l --format csv 2>/dev/null | grep -qx "${alias}"; then
    echo "error: image ${alias} missing, cannot bake docker" >&2
    return 1
  fi
  if ! compgen -G "${dest}/*.deb" >/dev/null; then
    echo "warn: no ${dest}/*.deb, skip docker bake" >&2
    return 0
  fi
  if ha_incus_image_has_docker; then
    echo "==> ${alias} already baked with docker.io"
    return 0
  fi

  echo "==> bake docker.io into ${alias} from ${dest} (S3/offline debs, no apt)"
  local tmp="ha-bake-docker"
  local n
  n="$(find "${dest}" -maxdepth 1 -name '*.deb' | wc -l)"
  echo "    ${n} debs in ${dest}"
  if [[ "${n}" -lt 3 ]]; then
    echo "error: not enough debs in ${dest}" >&2
    return 1
  fi
  incus delete "${tmp}" --force 2>/dev/null || true
  incus launch "${alias}" "${tmp}"
  local i
  for i in $(seq 1 40); do
    if incus exec "${tmp}" -- true >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  incus exec "${tmp}" -- cloud-init status --wait >/dev/null 2>&1 || true
  incus exec "${tmp}" -- bash -lc 'mkdir -p /etc/systemd/network
cat >/etc/systemd/network/10-eth0.network <<EOF
[Match]
Name=eth0

[Network]
DHCP=ipv4
EOF
systemctl restart systemd-networkd 2>/dev/null || true'
  incus exec "${tmp}" -- mkdir -p /root/ha-docker-debs
  local f base
  for f in "${dest}"/*.deb; do
    base="$(basename "${f}")"
    incus file push "${f}" "${tmp}/root/ha-docker-debs/${base}"
  done
  incus exec "${tmp}" --env DEBIAN_FRONTEND=noninteractive -- bash -lc \
    'dpkg -i /root/ha-docker-debs/*.deb >/root/ha-dpkg.log 2>&1 || true
     rm -rf /root/ha-docker-debs
     systemctl disable --now docker docker.socket >/dev/null 2>&1 || true
     /usr/bin/docker --version'
  incus exec "${tmp}" -- touch /etc/ha-cluster-docker-baked
  incus stop "${tmp}"
  if ! incus publish "${tmp}" --alias "${alias}"; then
    incus image alias delete "${alias}" 2>/dev/null || true
    incus publish "${tmp}" --alias "${alias}"
  fi
  incus delete "${tmp}" --force
  mkdir -p /var/lib/ha-cluster
  date -Iseconds > /var/lib/ha-cluster/workspace-image-docker
  echo "==> baked ${alias} with docker.io"
}

# 在线路径：只从 Depot 拉 workspace 镜像（+ 可选 workspace-debs），不拉 Incus deb 大包
ha_incus_fetch_workspace_assets() {
  local bundle_dir="$1"
  local arch series img_url name
  arch="$(ha_depot_arch 2>/dev/null || echo amd64)"
  series="${HA_UBUNTU_SERIES:-24.04}"
  mkdir -p "${bundle_dir}/images"

  if compgen -G "${bundle_dir}/images/ubuntu-*-root.tar.xz" >/dev/null; then
    return 0
  fi

  if declare -f ha_workspace_image_url >/dev/null 2>&1; then
    img_url="$(ha_workspace_image_url)"
  else
    img_url="${DEPOT_PUBLIC:-}/bundles/${arch}/images/ubuntu-${series}-server-cloudimg-${arch}-root.tar.xz"
  fi
  name="$(basename "${img_url}")"

  echo "==> fetch workspace image ${img_url}"
  if curl --connect-timeout 15 --max-time 0 -fSL "${img_url}" -o "${bundle_dir}/images/${name}"; then
    return 0
  fi

  echo "warn: standalone image missing, fetching slim workspace-assets bundle" >&2
  if declare -f ha_bundle_url >/dev/null 2>&1; then
    ha_incus_prepare_bundle "$(ha_bundle_url workspace-assets.tar.zst)" "${bundle_dir}" || true
  fi
}

ha_incus_bake_docker_online() {
  local alias="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
  if ha_incus_image_has_docker; then
    echo "==> ${alias} already baked with docker"
    return 0
  fi

  echo "==> bake docker.io into ${alias} via online apt (inside ephemeral container)"
  local tmp="ha-bake-docker"
  incus delete "${tmp}" --force 2>/dev/null || true
  incus launch "${alias}" "${tmp}"
  local i
  for i in $(seq 1 60); do
    incus exec "${tmp}" -- true >/dev/null 2>&1 && break
    sleep 1
  done
  incus exec "${tmp}" -- cloud-init status --wait >/dev/null 2>&1 || true
  local ws_codename="${HA_WORKSPACE_CODENAME:-noble}"
  local tuna_uri="https://mirrors.tuna.tsinghua.edu.cn/ubuntu"
  incus exec "${tmp}" --env DEBIAN_FRONTEND=noninteractive -- bash -lc \
    "export DEBIAN_FRONTEND=noninteractive
     CODENAME='${ws_codename}'
     cat >/etc/apt/sources.list.d/ubuntu-tuna.sources <<EOF
Types: deb
URIs: ${tuna_uri}
Suites: \${CODENAME} \${CODENAME}-updates \${CODENAME}-backports \${CODENAME}-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
     rm -f /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true
     apt-get update -qq
     apt-get install -y -qq docker.io
     systemctl disable --now docker docker.socket >/dev/null 2>&1 || true
     docker --version"
  incus exec "${tmp}" -- touch /etc/ha-cluster-docker-baked
  incus stop "${tmp}"
  if ! incus publish "${tmp}" --alias "${alias}"; then
    incus image alias delete "${alias}" 2>/dev/null || true
    incus publish "${tmp}" --alias "${alias}"
  fi
  incus delete "${tmp}" --force
  mkdir -p /var/lib/ha-cluster
  date -Iseconds > /var/lib/ha-cluster/workspace-image-docker
}

ha_incus_bake_docker_image_smart() {
  local dest="/var/lib/ha-cluster/workspace-debs"
  if compgen -G "${dest}/*.deb" >/dev/null; then
    ha_incus_bake_docker_image
  else
    ha_incus_bake_docker_online
  fi
}

ha_incus_offline_install() {
  local bundle_dir="$1"
  ha_incus_install_debs "${bundle_dir}"
  ha_incus_init
  ha_incus_ensure_profile
  ha_incus_network_fixup
  ha_incus_network_persist
  ha_incus_install_workspace_debs_host "${bundle_dir}"
  ha_incus_import_image "${bundle_dir}"
  ha_incus_bake_docker_image_smart
  ha_incus_network_fixup
  incus image list
  echo "==> incus ready on $(hostname)"
}
