#!/usr/bin/env bash
# Install ha-bastion on the control-plane host (42).
# Usage: HA_INTERNAL_TOKEN=… bash deploy/prod/bastion/install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${ROOT}/../../.." && pwd)"
BIN_DIR="${HA_BASTION_BIN:-/usr/local/bin}"
ETC_DIR="${HA_BASTION_ETC:-/etc/ha-cluster}"
STATE_DIR="${HA_BASTION_STATE:-/var/lib/ha-bastion}"
API_URL="${HA_API:-http://127.0.0.1:18082/api}"
INTERNAL_TOKEN="${HA_INTERNAL_TOKEN:?HA_INTERNAL_TOKEN required}"
USERS_CSV="${HA_BASTION_USERS:-admin,chenweipeng,huanghuabin,yexinwei,guohanli}"

echo "==> dirs"
mkdir -p "$ETC_DIR" "$STATE_DIR"
chmod 755 "$ETC_DIR" "$STATE_DIR"

echo "==> binaries"
if [[ -x "${REPO_ROOT}/dist/ha-bastion-proxy-linux-amd64" ]]; then
  install -m 0755 "${REPO_ROOT}/dist/ha-bastion-proxy-linux-amd64" "${BIN_DIR}/ha-bastion-proxy"
elif [[ -x "${ROOT}/ha-bastion-proxy" ]]; then
  install -m 0755 "${ROOT}/ha-bastion-proxy" "${BIN_DIR}/ha-bastion-proxy"
else
  echo "error: build ha-bastion-proxy first (dist/ha-bastion-proxy-linux-amd64)" >&2
  exit 1
fi
install -m 0755 "${REPO_ROOT}/deploy/ha-auth-keys.sh" "${BIN_DIR}/ha-auth-keys"

echo "==> bastion.env"
groupadd -f ha-bastion
umask 077
cat > "${ETC_DIR}/bastion.env" <<EOF
HA_API=${API_URL}
HA_INTERNAL_TOKEN=${INTERNAL_TOKEN}
HA_WS_SSH_USER=root
HA_BASTION_ENV=${ETC_DIR}/bastion.env
EOF

echo "==> workspace hop identity (shared with ha-api via HA_WEBSHELL_KEY_FILE)"
WS_KEY="${ETC_DIR}/bastion_ws_ed25519"
if [[ ! -f "$WS_KEY" ]]; then
  ssh-keygen -t ed25519 -N '' -f "$WS_KEY" -C "ha-bastion-ws"
fi
chmod 600 "$WS_KEY"
chmod 644 "${WS_KEY}.pub"
if ! grep -q '^HA_BASTION_IDENTITY=' "${ETC_DIR}/bastion.env"; then
  echo "HA_BASTION_IDENTITY=${WS_KEY}" >> "${ETC_DIR}/bastion.env"
fi
# ForceCommand runs as the platform user (needs read); AuthorizedKeysCommand runs as nobody.
chown root:ha-bastion "${ETC_DIR}/bastion.env" "$WS_KEY"
chmod 640 "${ETC_DIR}/bastion.env" "$WS_KEY"
chmod 644 "${WS_KEY}.pub"
if command -v setfacl >/dev/null 2>&1; then
  setfacl -m u:nobody:r "${ETC_DIR}/bastion.env"
fi

echo "==> sshd_config_bastion"
cp "${REPO_ROOT}/deploy/sshd-bastion.conf" /etc/ssh/sshd_config_bastion
# Append SetEnv so ForceCommand children inherit API credentials.
{
  echo ""
  echo "# appended by install.sh — do not commit secrets into the template"
  echo "SetEnv HA_API=${API_URL}"
  echo "SetEnv HA_INTERNAL_TOKEN=${INTERNAL_TOKEN}"
  echo "SetEnv HA_BASTION_ENV=${ETC_DIR}/bastion.env"
} >> /etc/ssh/sshd_config_bastion
chmod 600 /etc/ssh/sshd_config_bastion

echo "==> ensure host keys"
ssh-keygen -A >/dev/null 2>&1 || true

echo "==> platform login users (/bin/bash + ForceCommand; PAM rejects nologin before ForceCommand)"
IFS=',' read -ra USERS <<< "$USERS_CSV"
for u in "${USERS[@]}"; do
  u="$(echo "$u" | xargs)"
  [[ -z "$u" ]] && continue
  if ! id "$u" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$u" || true
  else
    usermod -s /bin/bash "$u" 2>/dev/null || true
  fi
  usermod -aG ha-bastion "$u" 2>/dev/null || true
  mkdir -p "/home/$u"
  chown "$u:$u" "/home/$u" 2>/dev/null || true
done

echo "==> systemd unit"
cp "${REPO_ROOT}/deploy/ha-bastion-sshd.service" /etc/systemd/system/ha-bastion-sshd.service
systemctl daemon-reload
sshd -t -f /etc/ssh/sshd_config_bastion
systemctl enable --now ha-bastion-sshd.service
systemctl restart ha-bastion-sshd.service
sleep 1
systemctl --no-pager --full status ha-bastion-sshd.service | head -20
ss -lntp | grep ':8099' || { echo "error: bastion not listening on 8099" >&2; exit 1; }
echo "==> bastion ready on :8099"
