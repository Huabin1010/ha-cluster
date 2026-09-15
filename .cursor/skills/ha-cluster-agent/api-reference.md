# API 参考（无密钥版）

默认基址 `https://cl.qzsyzn.com/api`。个性化 pack 以用户 token 为准。

公开：`GET /healthz`、`POST /auth/login`、`GET /agent-pack/version`（`{version,released_at,notes}`，本会话比一次）、`GET /agent-pack/{haagt_…}`（`?format=md`）。

错误 `{error,hint?}`。`error` 带具体原因，不要只报 409 Conflict，也不要用 curl -f 丢掉 body。常见码：`PURPOSE_REQUIRED`、`SECOND_PORT_CONFIRM_REQUIRED`、`INSUFFICIENT_CAPACITY: …`、`conflict: …`、`EXEC_UNAVAILABLE`、`K8S_UNAVAILABLE`。

我：`GET /me`、`/me/ssh-keys`、`GET|POST /me/agent-pack`（`{rotate}`）。

项目：`GET|POST /projects`（创建必须 `{name,slug,purpose}`，**name 须英文**如 `Office Snacks`，purpose 2–80 字可中文说明用途）、`GET|PATCH|DELETE /projects/{id}`（旧项目 purpose 为空时 PATCH 必须带 purpose，否则 409 `PURPOSE_REQUIRED`）、`/usage`、`/members`、`/invitations`、`/transfer-ownership`、`/ssh-access-request`。

机器：`GET /workspaces`（默认不含 `destroyed`，`?include_destroyed=1` 才返回；同名优先 `exec_ready=true` 的 running id）、`POST /projects/{id}/workspaces`（默认 `container`/Compose；用户要 k8s 才 `runtime=k8s`；developer 含 k8s 一律待审，owner/admin 直建）、`approve|reject|stop|start|resize|destroy-request`、`/connection`、`POST /workspaces/{id}/exec`（Docker+SSH；stdin_b64 已解码，写文件用 `cat > file`；SSH 不通 502 `EXEC_UNAVAILABLE` 并记下 `exec_ready=false`；**禁止在机器里构建**，也禁止用 exec 传二进制）、`GET /workspaces/{id}/kubeconfig`、`POST /workspaces/{id}/k8s/apply` `{yaml}`、`GET /workspaces/{id}/k8s/status`（探活主接口：副本/Pod/配额；`warnings` 只含当前代，旧 FailedCreate 在 `history`；k8s 不要 exec、不要借 Docker 机 kubectl）、`GET|DELETE /workspaces/{id}/k8s/resources`、`/ingress`、`/ingress/shared`。

入口：`GET /ingress/meta`（含 `preferred_registry`；领域名时才打）、`POST|DELETE /ingress/{id}`。公共域已挂平台通配符 HTTPS。

镜像：`GET /registries/preferred` → CNB `docker.cnb.cool`（推送/部署优先；不确定仓库名才打）。平台仓库配置仍是 `/admin/docker-registries`。

平台：`/admin/join-tokens`、`/admin/docker-registries`、`/admin/ingress-domains`、`/admin/tls-certs`（`GET` 状态；`POST …/issue` 签发/续期；`PATCH …` `{auto_renew}`；到期前 30 天自动续）、`/admin/dangerous-approvals`、`/nodes`、`/capacity`、`/users`、`/audit-logs`。

`arch`：`amd64|arm64|any`（`x86_64`→amd64）。重复加人 409。磁盘不能缩。
