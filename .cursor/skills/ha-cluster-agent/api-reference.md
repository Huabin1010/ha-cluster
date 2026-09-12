# API 参考（无密钥版）

默认基址 `https://cl.qzsyzn.com/api`。个性化 pack 以用户 token 为准。

公开：`GET /healthz`、`POST /auth/login`、`GET /agent-pack/{haagt_…}`（`?format=md`）。

我：`GET /me`、`/me/ssh-keys`、`GET|POST /me/agent-pack`（`{rotate}`）。

项目：`GET|POST /projects`、`GET|PATCH|DELETE /projects/{id}`、`/usage`、`/members`、`/invitations`、`/transfer-ownership`、`/ssh-access-request`。

机器：`GET /workspaces`、`POST /projects/{id}/workspaces`、`approve|reject|stop|start|resize|destroy-request`、`/ssh-config`、`/connection`、`/ingress`、`/ingress/shared`。

入口：`GET /ingress/meta`、`POST|DELETE /ingress/{id}`。

平台：`/admin/join-tokens`、`/admin/docker-registries`、`/admin/ingress-domains`、`/admin/dangerous-approvals`、`/nodes`、`/capacity`、`/users`、`/audit-logs`。

`arch`：`amd64|arm64|any`（`x86_64`→amd64）。重复加人 409。磁盘不能缩。
