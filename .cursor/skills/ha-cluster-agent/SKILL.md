---
name: ha-cluster-agent
pack_version: "8"
description: >-
  Operates the ha-cluster control plane as a signed-in user via REST. Use when
  creating projects, provisioning workspaces (machines), managing members or
  SSH, claiming apps domains, managing HTTPS certificates, or doing any
  console action. Prefer a personal pack token from the console「复制专属链接」;
  do not ask for a password. Check pack version before acting.
---

# ha-cluster Agent（仓库内）

终端用户的**个性化** skill / rule 从控制台侧栏「复制专属链接」获取：Agent **只用 curl** 拉该 URL（禁止 Cursor fetch / WebFetch），按 `files` 写入当前工作区。本目录是同一套操作说明的**无密钥**版本，给开发本仓库的 Agent 用。

## 先检查 skill 版本（每次开干前）

本地版本见 [VERSION](VERSION)（本文件 `pack_version` 同源），当前是 **8**。

```bash
curl -fsS "${HA_API_BASE:-https://cl.qzsyzn.com/api}/agent-pack/version"
```

返回 `{version, released_at, notes}`。`version` 是递增整数。若服务端 **大于** 本地：

1. 用户已有专属链接 / `HA_AGENT_TOKEN`：`curl -fsSL "$HA_API_BASE/agent-pack/$HA_AGENT_TOKEN"`（或用户给的 pack URL），按 `files` 覆盖写入。
2. 正在开发本仓库：以 `internal/agentpack/embed/` 为源同步本目录，再核对 VERSION。
3. 都没有：让用户在控制台再点一次「复制专属链接」。

用户说「平台更新了 / 升级 skill」时也走这一步。

## 凭证

1. 用户已粘贴 pack → 读 `.cursor/skills/ha-cluster-agent/SKILL.md` 里的 `Bearer`（若已覆盖本文件）。
2. 否则用环境变量 `HA_AGENT_TOKEN`（`haagt_…`）或控制台登录后的短期 JWT。
3. 默认 API：`https://cl.qzsyzn.com/api`（可用 `HA_API_BASE` 覆盖）。

```bash
curl -fsS -H "Authorization: Bearer $HA_AGENT_TOKEN" "${HA_API_BASE:-https://cl.qzsyzn.com/api}/me"
```

列表 `{data,total}`。错误 `{error}`：400 / 401 / 403 / 404 / 409。

默认开 **Docker + SSH** 机器，用 **Compose** 部署（`POST /workspaces/{id}/exec` 里 `docker compose up`）。用户没提 Kubernetes / k3s / kubectl 时不要开 `runtime=k8s`。只有用户明确要 k8s 才 apply YAML / 下载 kubeconfig；对该类机器 exec 会 400。Kubernetes 与 Docker **同一审批**：developer 须等 owner/admin 批准；owner/admin 直建。

创建项目必须带简洁 `purpose`（2–80 字，一句话说清这个项目是干什么的），不要空、不要复述 name/slug。旧项目 `purpose` 为空时先 `PATCH /projects/{id}` `{purpose}`，否则开通 / 加人 / SSH / exec 会 `409 PURPOSE_REQUIRED`。

推送镜像或部署时优先用 **CNB** `docker.cnb.cool/<组织>/<仓库>:<标签>`（`GET /registries/preferred`），不要默认 Docker Hub。

公共域 `*.apps` 出厂带平台通配符 HTTPS（ACME 自动续期）。`platform_admin` 看 `GET /admin/tls-certs`，立即签发 `POST /admin/tls-certs/{id}/issue`。

完整接口表：[api-reference.md](api-reference.md)。工作流：[workflows.md](workflows.md)。

生成这些文件的源模板在 `internal/agentpack/embed/`。改操作说明时改模板，并同步本目录。
