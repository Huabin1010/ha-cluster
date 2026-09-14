# API 参考（无密钥版）

默认基址 `https://cl.qzsyzn.com/api`。个性化 pack 以用户 token 为准。

公开：`GET /healthz`、`POST /auth/login`、`GET /agent-pack/version`（`{version,released_at,notes}`，与本地 VERSION 比较）、`GET /agent-pack/{haagt_…}`（`?format=md`）。

我：`GET /me`、`/me/ssh-keys`、`GET|POST /me/agent-pack`（`{rotate}`）。

项目：`GET|POST /projects`、`GET|PATCH|DELETE /projects/{id}`、`/usage`、`/members`、`/invitations`、`/transfer-ownership`、`/ssh-access-request`。

机器：`GET /workspaces`、`POST /projects/{id}/workspaces`（默认 `container`/Compose；用户要 k8s 才 `runtime=k8s`；developer 含 k8s 一律待审，owner/admin 直建）、`approve|reject|stop|start|resize|destroy-request`、`/connection`、`POST /workspaces/{id}/exec`（Docker+SSH）、`GET /workspaces/{id}/kubeconfig`、`POST /workspaces/{id}/k8s/apply` `{yaml}`、`GET|DELETE /workspaces/{id}/k8s/resources`、`/ingress`、`/ingress/shared`。

入口：`GET /ingress/meta`（含 `preferred_registry`）、`POST|DELETE /ingress/{id}`。公共域已挂平台通配符 HTTPS。

镜像：`GET /registries/preferred` → CNB `docker.cnb.cool`（推送/部署优先）。平台仓库配置仍是 `/admin/docker-registries`。

平台：`/admin/join-tokens`、`/admin/docker-registries`、`/admin/ingress-domains`、`/admin/tls-certs`（`GET` 状态；`POST …/issue` 签发/续期；`PATCH …` `{auto_renew}`；到期前 30 天自动续）、`/admin/dangerous-approvals`、`/nodes`、`/capacity`、`/users`、`/audit-logs`。

`arch`：`amd64|arm64|any`（`x86_64`→amd64）。重复加人 409。磁盘不能缩。
