---
name: deploy-prod
description: >-
  Rolling-deploys the ha-cluster control plane (API + console) to production
  host 42.193.236.123 without restarting Postgres. Use when the user says
  更新部署, 上线, 发布, rolling-up, deploy to 42, or update cl.qzsyzn.com.
  Not for Baota DNS/SSL (use baota-panel) and not for PVE lab unless asked.
---

# 生产控制面滚动部署（42）

**先读** [`.cursor/rules/prod-runtime-baota.mdc`](../../rules/prod-runtime-baota.mdc)。  
远程目录：`/www/wwwroot/cl.qzsyzn.com/docker`。主机：`root@42.193.236.123`。

用户说「更新部署 / 上线」且没提实验室 → **只发 42 控制面**。实验室是 `192.168.1.60`，须用户点名才动。DNS / 反代 / 证书走 `baota-panel`，不要手改宝塔 vhost。

## 禁止

- ❌ `docker compose stop ha-api` / 整栈 `up -d` 一把重建（会断控制台）
- ❌ 重启或 recreate `ha-postgres`
- ❌ 在 PVE 宿主机 `192.168.1.8` 或 Hub `110.40.229.62` 上跑 ha-api
- ❌ `docker compose pull` 拉 GHCR（生产用已 load 的 `ha-cluster-api:local`）
- ❌ 打印 `.env` / JWT / 宝塔密钥全文；一次性脚本只写 `tmp/`

## 流程

本机 Docker 必须已开。PowerShell **不要**用 `&&` 串命令。

### 1. 看现状

```bash
curl -fsS https://cl.qzsyzn.com/api/agent-pack/version
ssh -o BatchMode=yes root@42.193.236.123 "docker ps --format '{{.Names}} {{.Status}}' | grep -E 'ha-api|ha-postgres|ha-edge'; docker inspect -f '{{.State.StartedAt}}' ha-postgres"
```

记下 Postgres `StartedAt` 与当前 pack `version`。

### 2. 构建镜像

```powershell
docker build -f docker/Dockerfile -t ha-cluster-api:local .
```

镜像含 `ha-api` + `web/dist`。改了 Go / 前端 / agent pack 都要走这一步。

### 3. 传上去

```powershell
docker save ha-cluster-api:local -o tmp/ha-cluster-api-local.tar
scp -o BatchMode=yes tmp/ha-cluster-api-local.tar root@42.193.236.123:/tmp/ha-cluster-api-local.tar
```

若改了 `deploy/prod/docker-compose.yaml`、`edge/nginx.conf`、`rolling-up.sh`，一并 scp 到远程目录，远程 `sed -i 's/\r$//'`。

### 4. 滚动双槽

在 42 上 **load 后只跑** [`deploy/prod/rolling-up.sh`](../../../deploy/prod/rolling-up.sh)（一侧 unhealthy 就停，不拆另一侧）：

```bash
ssh -o BatchMode=yes root@42.193.236.123 'set -e
DIR=/www/wwwroot/cl.qzsyzn.com/docker
cd "$DIR"
docker load -i /tmp/ha-cluster-api-local.tar
rm -f /tmp/ha-cluster-api-local.tar
grep -q "^HA_API_IMAGE=" .env && sed -i "s|^HA_API_IMAGE=.*|HA_API_IMAGE=ha-cluster-api:local|" .env || echo HA_API_IMAGE=ha-cluster-api:local >> .env
sed -i "s/\r$//" rolling-up.sh
chmod +x rolling-up.sh
bash ./rolling-up.sh
'
```

只改脚本、不换镜像时，可用 [`deploy/prod/rolling-up.ps1`](../../../deploy/prod/rolling-up.ps1)。

### 5. 验收（必须）

两边槽位 + 公网都要看，且 Postgres `StartedAt` **与步骤 1 相同**：

```bash
curl -fsS http://127.0.0.1:18082/api/agent-pack/version   # 在 42 上
curl -fsS http://127.0.0.1:18084/api/agent-pack/version
curl -fsS http://127.0.0.1:18080/healthz                  # 无 Host 也应 200
curl -fsS https://cl.qzsyzn.com/api/agent-pack/version
curl -fsS -o /dev/null -w "%{http_code}" https://cl.qzsyzn.com/
```

pack `version` 须等于仓库 `internal/agentpack/pack.go` 的 `Version`。告诉用户 **Ctrl+F5** 清前端缓存。

## 探活坑

`ha-edge` 按 Host 分流。打 `127.0.0.1:18080/healthz` 不带 Host 时，旧配置会 **404**（默认站），**不是** API 没起来。槽位探活用 `18082` / `18084`。默认站现已有 `/healthz`；`rolling-up.sh` 还会带 `Host: cl.qzsyzn.com`。

## 拓扑速查

| 项 | 值 |
|----|-----|
| 控制台 | `https://cl.qzsyzn.com` |
| 公网入口 | 宝塔 443 → `127.0.0.1:18080`（edge）→ `ha-api-a`/`ha-api-b` |
| 槽位 | `127.0.0.1:18082`、`127.0.0.1:18084` |
| 镜像 | `HA_API_IMAGE=ha-cluster-api:local` |
| Compose 网段 | `172.28.90.0/24` |
