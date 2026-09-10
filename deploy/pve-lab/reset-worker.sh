#!/usr/bin/env bash
# 重置 Worker 到未安装状态（便于重复验收一键安装）
set -euo pipefail

systemctl stop ha-agent easytier 2>/dev/null || true
systemctl disable ha-agent easytier 2>/dev/null || true
rm -f /usr/local/bin/ha-agent /usr/local/bin/easytier-core
rm -f /etc/systemd/system/ha-agent.service /etc/systemd/system/easytier.service
rm -f /etc/ha-cluster/easytier.env
systemctl daemon-reload
echo "==> reset ok $(hostname)"
