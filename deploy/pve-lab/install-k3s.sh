#!/usr/bin/env bash
# 离线安装 / 升级 k3s：只从 Depot（S3）拉二进制与 airgap 镜像。
# 禁止 curl GitHub / get.k3s.io / 官方 install.sh（那些会出网）。
#
# 角色：
#   HA_K3S_ROLE=server|agent|auto（默认 auto）
#   auto：已有 k3s.service → 保持 server；已有 k3s-agent → 保持 agent；
#         否则有 HA_K3S + HA_K3S_TOKEN → agent，其余 → 本机起 server。
#
# 幂等：已装则覆盖二进制 + 镜像并重启，不拆集群数据。
set -euo pipefail

SETUP_DIR="${HA_SETUP_DIR:-/var/lib/ha-setup}"
INSTALL_ROOT="${HA_INSTALL_ROOT:-/tmp/ha-pve-lab-install}"
K3S_IMAGES="/var/lib/rancher/k3s/agent/images"
K3S_BIN="/usr/local/bin/k3s"
READY_FILE="${SETUP_DIR}/k3s.ready"
K3S_ENV="/etc/ha-cluster/k3s.env"

mkdir -p "${INSTALL_ROOT}" "${SETUP_DIR}" /etc/ha-cluster

ha_k3s_need_depot() {
  if declare -F ha_bundle_url >/dev/null 2>&1 && declare -F ha_bin_url >/dev/null 2>&1; then
    return 0
  fi
  if [[ -f "${INSTALL_ROOT}/depot-paths.sh" ]]; then
    # shellcheck disable=SC1091
    source "${INSTALL_ROOT}/depot-paths.sh"
    return 0
  fi
  echo "error: source depot-paths.sh first (ha_bin_url / ha_bundle_url)" >&2
  return 1
}

ha_k3s_forbid_online() {
  # 目标机不得走官方安装器；维护者机才允许 fetch-deps。
  if [[ "${HA_K3S_ALLOW_ONLINE:-0}" == "1" ]]; then
    return 0
  fi
  if [[ -n "${INSTALL_K3S_SKIP_DOWNLOAD:-}" && "${INSTALL_K3S_SKIP_DOWNLOAD}" != "true" ]]; then
    echo "error: refuse online k3s install (INSTALL_K3S_SKIP_DOWNLOAD must be true)" >&2
    return 1
  fi
}

ha_k3s_curl() {
  local url="$1" dest="$2" timeout="${3:-600}"
  echo "  GET ${url}"
  curl --connect-timeout 15 --max-time "${timeout}" -fL --retry 5 --retry-delay 2 -o "${dest}.partial" "${url}"
  mv -f "${dest}.partial" "${dest}"
}

ha_k3s_extract_offline_tar() {
  local archive="$1" dest="$2"
  mkdir -p "${dest}"
  case "${archive}" in
    *.tar.gz | *.tgz)
      tar -xzf "${archive}" -C "${dest}"
      ;;
    *.tar.zst)
      if command -v zstd >/dev/null 2>&1; then
        zstd -d -c "${archive}" | tar -xf - -C "${dest}"
      else
        echo "error: need zstd to unpack ${archive}; use two-file Depot fallback" >&2
        return 1
      fi
      ;;
    *.tar)
      tar -xf "${archive}" -C "${dest}"
      ;;
    *)
      echo "error: unknown k3s bundle ${archive}" >&2
      return 1
      ;;
  esac
}

# 只从 Depot 拉：优先一包 k3s-offline.tar.gz，否则 bin/k3s + airgap。
ha_k3s_fetch_artifacts() {
  ha_k3s_need_depot
  local stage="${INSTALL_ROOT}/k3s-offline"
  rm -rf "${stage}"
  mkdir -p "${stage}" "${K3S_IMAGES}"

  # 不用 HEAD：部分 S3/RustFS 对 HEAD 返回 403/405。GET 失败再回退两文件。
  local offline_gz offline_zst
  offline_gz="$(ha_bundle_url k3s-offline.tar.gz)"
  offline_zst="$(ha_bundle_url k3s-offline.tar.zst)"
  if curl --connect-timeout 15 --max-time 600 -fL --retry 3 --retry-delay 2 \
    -o "${INSTALL_ROOT}/k3s-offline.tar.gz.partial" "${offline_gz}"; then
    mv -f "${INSTALL_ROOT}/k3s-offline.tar.gz.partial" "${INSTALL_ROOT}/k3s-offline.tar.gz"
    echo "  GET ${offline_gz}"
    ha_k3s_extract_offline_tar "${INSTALL_ROOT}/k3s-offline.tar.gz" "${stage}"
  elif curl --connect-timeout 15 --max-time 600 -fL --retry 3 --retry-delay 2 \
    -o "${INSTALL_ROOT}/k3s-offline.tar.zst.partial" "${offline_zst}"; then
    mv -f "${INSTALL_ROOT}/k3s-offline.tar.zst.partial" "${INSTALL_ROOT}/k3s-offline.tar.zst"
    echo "  GET ${offline_zst}"
    ha_k3s_extract_offline_tar "${INSTALL_ROOT}/k3s-offline.tar.zst" "${stage}"
  else
    rm -f "${INSTALL_ROOT}/k3s-offline.tar.gz.partial" "${INSTALL_ROOT}/k3s-offline.tar.zst.partial"
    echo "==> k3s two-file fallback (bin + airgap)"
    ha_k3s_curl "$(ha_bin_url k3s)" "${stage}/k3s" 180
    ha_k3s_curl "$(ha_bundle_url k3s-airgap-images.tar.zst)" \
      "${stage}/k3s-airgap-images.tar.zst" 900
  fi

  local bin="" img=""
  if [[ -x "${stage}/k3s" ]]; then
    bin="${stage}/k3s"
  elif [[ -f "${stage}/k3s" ]]; then
    chmod +x "${stage}/k3s"
    bin="${stage}/k3s"
  fi
  img="$(find "${stage}" -type f \( -name 'k3s-airgap-images*.tar.zst' -o -name 'k3s-airgap-images*.tar' \) | head -n1 || true)"
  if [[ -z "${bin}" || ! -f "${bin}" ]]; then
    echo "error: k3s binary missing in Depot artifacts" >&2
    return 1
  fi
  if [[ -z "${img}" || ! -f "${img}" ]]; then
    echo "error: k3s airgap image missing in Depot artifacts" >&2
    return 1
  fi

  install -m 0755 "${bin}" "${K3S_BIN}"
  cp -f "${img}" "${K3S_IMAGES}/$(basename "${img}")"
  echo "==> k3s binary $(${K3S_BIN} --version 2>/dev/null | head -n1 || echo ok)"
}

ha_k3s_wait_fabric_ip() {
  local ip="${FABRIC_IP:-${HA_FABRIC_IP:-}}"
  [[ -n "${ip}" ]] || return 0
  local i
  for i in $(seq 1 45); do
    if ip -4 addr show | grep -q " ${ip}/"; then
      return 0
    fi
    sleep 2
  done
  echo "warn: fabric IP ${ip} not on any iface yet; k3s will still start" >&2
}

ha_k3s_pick_iface() {
  local ip="${FABRIC_IP:-${HA_FABRIC_IP:-}}"
  if ip link show easytier >/dev/null 2>&1; then
    echo "easytier"
    return 0
  fi
  if [[ -n "${ip}" ]]; then
    ip -4 -o addr show | awk -v want="${ip}" '$4 ~ "^"want"/" {print $2; exit}'
    return 0
  fi
  echo ""
}

ha_k3s_existing_role() {
  if systemctl list-unit-files k3s.service >/dev/null 2>&1 && [[ -f /etc/systemd/system/k3s.service ]]; then
    echo "server"
    return 0
  fi
  if systemctl list-unit-files k3s-agent.service >/dev/null 2>&1 && [[ -f /etc/systemd/system/k3s-agent.service ]]; then
    echo "agent"
    return 0
  fi
  echo ""
}

ha_k3s_resolve_role() {
  local want="${HA_K3S_ROLE:-auto}"
  want="${want//$'\r'/}"
  local existing
  existing="$(ha_k3s_existing_role)"
  case "${want}" in
    server | agent)
      echo "${want}"
      return 0
      ;;
    auto | "")
      if [[ -n "${existing}" ]]; then
        echo "${existing}"
        return 0
      fi
      if [[ -n "${HA_K3S:-}" && -n "${HA_K3S_TOKEN:-}" ]]; then
        echo "agent"
        return 0
      fi
      echo "server"
      return 0
      ;;
    *)
      echo "error: invalid HA_K3S_ROLE=${want}" >&2
      return 1
      ;;
  esac
}

ha_k3s_write_server_unit() {
  local node_ip="$1" iface="$2" extra_san="$3"
  local exec_args="server --advertise-address=${node_ip} --node-ip=${node_ip} --tls-san=${node_ip} --disable=traefik"
  if [[ -n "${extra_san}" && "${extra_san}" != "${node_ip}" ]]; then
    exec_args+=" --tls-san=${extra_san}"
  fi
  if [[ -n "${iface}" ]]; then
    exec_args+=" --flannel-iface=${iface}"
  fi
  cat >/etc/systemd/system/k3s.service <<EOF
[Unit]
Description=k3s server (ha-cluster offline)
After=network-online.target easytier.service
Wants=network-online.target

[Service]
Type=notify
NotifyAccess=all
KillMode=process
Delegate=yes
LimitNOFILE=1048576
LimitNPROC=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always
RestartSec=5s
Environment=INSTALL_K3S_SKIP_DOWNLOAD=true
EnvironmentFile=-${SETUP_DIR}/join.env
EnvironmentFile=-${K3S_ENV}
ExecStart=${K3S_BIN} ${exec_args}

[Install]
WantedBy=multi-user.target
EOF
}

ha_k3s_write_agent_unit() {
  local node_ip="$1" iface="$2"
  local server_url="${HA_K3S:?HA_K3S (k3s server URL) required for agent role}"
  local token="${HA_K3S_TOKEN:?HA_K3S_TOKEN required for agent role}"
  local exec_args="agent --server ${server_url} --token ${token} --node-ip=${node_ip}"
  if [[ -n "${iface}" ]]; then
    exec_args+=" --flannel-iface=${iface}"
  fi
  cat >/etc/systemd/system/k3s-agent.service <<EOF
[Unit]
Description=k3s agent (ha-cluster offline)
After=network-online.target easytier.service
Wants=network-online.target

[Service]
Type=notify
NotifyAccess=all
KillMode=process
Delegate=yes
LimitNOFILE=1048576
LimitNPROC=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always
RestartSec=5s
Environment=INSTALL_K3S_SKIP_DOWNLOAD=true
EnvironmentFile=-${SETUP_DIR}/join.env
EnvironmentFile=-${K3S_ENV}
ExecStart=${K3S_BIN} ${exec_args}

[Install]
WantedBy=multi-user.target
EOF
}

ha_k3s_set_join_kv() {
  local file="$1" key="$2" val="$3"
  mkdir -p "$(dirname "${file}")"
  touch "${file}"
  if grep -q "^${key}=" "${file}" 2>/dev/null; then
    # 不用 sed -i（部分系统/busybox 行为不一）
    local tmp
    tmp="$(mktemp)"
    awk -v k="${key}" -v v="${val}" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "${file}" >"${tmp}"
    mv -f "${tmp}" "${file}"
  else
    printf '%s=%s\n' "${key}" "${val}" >>"${file}"
  fi
}

ha_k3s_wait_ready() {
  local role="$1"
  local i
  echo "==> wait k3s ${role} ready"
  for i in $(seq 1 90); do
    if [[ "${role}" == "server" ]]; then
      if "${K3S_BIN}" kubectl get nodes --no-headers 2>/dev/null | grep -q .; then
        "${K3S_BIN}" kubectl get nodes -o wide || true
        return 0
      fi
    else
      if systemctl is-active --quiet k3s-agent; then
        return 0
      fi
    fi
    sleep 2
  done
  echo "error: k3s ${role} not ready in time" >&2
  if [[ "${role}" == "agent" ]]; then
    journalctl -u k3s-agent -n 80 --no-pager >&2 || true
  else
    journalctl -u k3s -n 80 --no-pager >&2 || true
  fi
  return 1
}

ha_k3s_mark_ready() {
  local role="$1"
  mkdir -p "${SETUP_DIR}" /etc/ha-cluster
  cat >"${K3S_ENV}" <<EOF
HA_K3S_ROLE=${role}
HA_NODE_TAGS=k3s,both
EOF
  chmod 600 "${K3S_ENV}"
  date -u +%Y-%m-%dT%H:%M:%SZ >"${READY_FILE}"
  ha_k3s_set_join_kv "${SETUP_DIR}/join.env" "HA_NODE_TAGS" "k3s,both"
  ha_k3s_set_join_kv "${SETUP_DIR}/join.env" "HA_K3S_ROLE" "${role}"
  if [[ "${role}" == "server" && -f /var/lib/rancher/k3s/server/node-token ]]; then
    cp -f /var/lib/rancher/k3s/server/node-token "${SETUP_DIR}/k3s.node-token"
    chmod 600 "${SETUP_DIR}/k3s.node-token"
  fi
}

ha_k3s_install_worker() {
  ha_k3s_forbid_online
  export INSTALL_K3S_SKIP_DOWNLOAD=true

  local node_ip="${FABRIC_IP:-${HA_FABRIC_IP:-}}"
  if [[ -z "${node_ip}" ]]; then
    echo "error: FABRIC_IP / HA_FABRIC_IP required for k3s --node-ip" >&2
    return 1
  fi

  echo "==> k3s offline install from $(ha_depot_base 2>/dev/null || echo Depot)"
  ha_k3s_fetch_artifacts
  ha_k3s_wait_fabric_ip

  local role iface lan
  role="$(ha_k3s_resolve_role)"
  iface="$(ha_k3s_pick_iface || true)"
  lan="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "==> k3s role=${role} node-ip=${node_ip} iface=${iface:-default}"

  if [[ "${role}" == "server" ]]; then
    rm -f /etc/systemd/system/k3s-agent.service
    ha_k3s_write_server_unit "${node_ip}" "${iface}" "${lan}"
    systemctl daemon-reload
    systemctl enable k3s
    systemctl restart k3s
    ha_k3s_wait_ready server
  else
    rm -f /etc/systemd/system/k3s.service
    ha_k3s_write_agent_unit "${node_ip}" "${iface}"
    systemctl daemon-reload
    systemctl enable k3s-agent
    systemctl restart k3s-agent
    ha_k3s_wait_ready agent
  fi

  ha_k3s_mark_ready "${role}"
  echo "==> k3s ${role} ready"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ha_k3s_need_depot
  ha_k3s_install_worker
fi
