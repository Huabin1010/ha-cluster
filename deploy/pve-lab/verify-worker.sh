#!/usr/bin/env bash
# Worker 安装后验收（失败则 exit 1，避免「脚本跑完却不可用」）
set -eu

NODE_NAME="${NODE_NAME:-$(hostname)}"
HA_INCUS_IMAGE="${HA_INCUS_IMAGE:-ha-ubuntu-24.04}"
SKIP_INCUS="${SKIP_INCUS:-0}"
SKIP_EASYTIER="${SKIP_EASYTIER:-0}"
FAIL=0

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "  OK   ${name}"
  else
    echo "  FAIL ${name}" >&2
    FAIL=1
  fi
}

echo "==> verify worker ${NODE_NAME}"

check "ha-agent active" systemctl is-active --quiet ha-agent
check "ha-agent binary" test -x /usr/local/bin/ha-agent
if grep -qF docker_registries <<< "$(strings /usr/local/bin/ha-agent 2>/dev/null || true)"; then
  echo "  OK   ha-agent supports docker_registries"
else
  echo "  FAIL ha-agent missing docker_registries (redeploy from Depot)" >&2
  FAIL=1
fi

if [[ "${SKIP_EASYTIER}" != "1" ]]; then
  check "easytier active" systemctl is-active --quiet easytier
  check "easytier-core" test -x /usr/local/bin/easytier-core
fi

if [[ "${SKIP_INCUS}" != "1" ]]; then
  check "incus CLI" command -v incus
  check "incus daemon" sh -c "incus info >/dev/null 2>&1"
  check "incus image ${HA_INCUS_IMAGE}" sh -c "incus image list -c l --format csv | grep -Fx '${HA_INCUS_IMAGE}'"
  check "workspace image baked docker.io" test -f /var/lib/ha-cluster/workspace-image-docker
  check "incus network fixup unit" systemctl is-enabled --quiet ha-incus-network.service

  if [[ "${HA_VERIFY_EGRESS:-1}" == "0" ]]; then
    echo "  SKIP incus egress smoke test (HA_VERIFY_EGRESS=0)"
  else
  echo "==> incus egress smoke test"
  tmp="ha-verify-$$"
  if incus launch "${HA_INCUS_IMAGE}" "${tmp}" --ephemeral >/dev/null 2>&1; then
    ok_net=0
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if incus exec "${tmp}" -- ping -c1 -W3 8.8.8.8 >/dev/null 2>&1; then
        ok_net=1
        break
      fi
      sleep 2
    done
    if [[ "${ok_net}" -eq 1 ]]; then
      echo "  OK   incus container egress"
    else
      echo "  FAIL incus container cannot reach internet (check FORWARD / NAT)" >&2
      FAIL=1
    fi
    incus delete "${tmp}" --force 2>/dev/null || true
  else
    echo "  FAIL incus ephemeral launch" >&2
    FAIL=1
  fi
  fi
fi

if [[ "${FAIL}" -ne 0 ]]; then
  echo "==> verify FAILED on ${NODE_NAME}" >&2
  exit 1
fi
echo "==> verify passed on ${NODE_NAME}"
