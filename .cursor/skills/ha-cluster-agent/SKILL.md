---
name: ha-cluster-agent
pack_version: "14"
description: >-
  Operates the ha-cluster control plane as a signed-in user via REST. Use when
  creating projects, provisioning workspaces (machines), managing members or
  SSH, claiming apps domains, managing HTTPS certificates, or doing any
  console action. Prefer a personal pack token from the console「复制专属链接」;
  do not ask for a password. Check pack version before acting.
---

# ha-cluster Agent（仓库内）

终端用户的**个性化** skill / rule 从控制台侧栏「复制专属链接」获取：Agent **只用 curl** 拉该 URL（禁止 Cursor fetch / WebFetch），按 `files` 写入当前工作区。本目录是同一套操作说明的**无密钥**版本，给开发本仓库的 Agent 用。

## 本会话只需一次

本地版本见 [VERSION](VERSION)（本文件 `pack_version` 同源），当前是 **14**。

```bash
curl -fsS "${HA_API_BASE:-https://cl.qzsyzn.com/api}/agent-pack/version"
```

返回 `{version, released_at, notes}`。服务端 **大于** 本地才重拉 pack。同一段对话里再 `GET /me` 一次确认身份，然后按用户这句话动手——**不要**每个任务都 GET `/projects` `/workspaces` `/ingress/meta` `/registries/preferred` 再 exec 探活。撞到 `409 PURPOSE_REQUIRED` 再 PATCH。

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

列表 `{data,total}`。错误 `{error,hint?}`：400 / 401 / 403 / 404 / 409 / 502 `EXEC_UNAVAILABLE` / 503 `K8S_UNAVAILABLE`。

## 发版决策树（硬规则）

1. 先看本机 `~/.docker/config.json`（Windows `%USERPROFILE%\.docker\config.json`）的 `auths` 是否有 `docker.cnb.cool`，或是否有 `credsStore` / 本地已有 `docker.cnb.cool/...` 镜像。**不要**用 `docker info` 的 `IndexConfigs` 判断没登录。
2. 有 → 本机 `docker build` / `docker push`；`exec` 只 `docker pull` + `run` / `compose up` + `docker logs`。
3. 没有 → 仍在本机构建；请用户 `docker login docker.cnb.cool`。机器注入的凭据只用于 pull。
4. **禁止**把可执行文件 base64 分片塞进 `exec`；**禁止**在申请的机器里构建。

默认开 **Docker + SSH** 机器，用 Compose **跑已经编好的镜像**。用户没提 Kubernetes / k3s / kubectl 时不要开 `runtime=k8s`。Kubernetes 与 Docker **同一审批**。

创建项目必须带简洁 `purpose`（2–80 字）。旧项目为空时先 `PATCH /projects/{id}` `{purpose}`，否则 `409 PURPOSE_REQUIRED`。

选机器：`GET /workspaces` **默认不含 destroyed**；同名取 `exec_ready=true` 且 `running` 的 **id**（不要只看 `updated_at`）。`exec_ready=false` 先 `POST /start` 或换一台；字段缺省才短命令探一次。`running` ≠ exec 通。

k8s 工作区 `POST /exec` 会 400。apply 之后用 `GET /workspaces/{id}/k8s/status` 看副本、Pod 阶段、release 标签、配额告警。容器必须写 `resources.requests.cpu/memory`，否则会被 `project-quota` 拦住。**禁止**把 kubeconfig 写进另一台 Docker 机器再 exec kubectl / python 探活。

公共域 `*.apps` 出厂带平台通配符 HTTPS。`platform_admin` 看 `GET /admin/tls-certs`，立即签发 `POST /admin/tls-certs/{id}/issue`。

Windows：禁止 `$pid` 当变量；JSON 写文件后 `curl.exe --data-binary @file`；不要多行 `python -c`。写文件用 `cat > file` + `stdin_b64`（平台已解码），不要 `base64 -d`。部署后看 `docker logs`；bind mount 给非 root `USER` 要先 chown。

完整接口表：[api-reference.md](api-reference.md)。工作流：[workflows.md](workflows.md)。

生成这些文件的源模板在 `internal/agentpack/embed/`。改操作说明时改模板，并同步本目录。
