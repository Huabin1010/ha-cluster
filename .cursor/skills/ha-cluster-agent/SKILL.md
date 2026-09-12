---
name: ha-cluster-agent
description: >-
  Operates the ha-cluster control plane as a signed-in user via REST. Use when
  creating projects, provisioning workspaces (machines), managing members or
  SSH, claiming apps domains, or doing any console action. Prefer a personal
  pack token from the console「复制专属链接」; do not ask for a password.
---

# ha-cluster Agent（仓库内）

终端用户的**个性化** skill / rule 从控制台侧栏「复制专属链接」获取：Agent **只用 curl** 拉该 URL（禁止 Cursor fetch / WebFetch），按 `files` 写入当前工作区。本目录是同一套操作说明的**无密钥**版本，给开发本仓库的 Agent 用。

## 凭证

1. 用户已粘贴 pack → 读 `.cursor/skills/ha-cluster-agent/SKILL.md` 里的 `Bearer`（若已覆盖本文件）。
2. 否则用环境变量 `HA_AGENT_TOKEN`（`haagt_…`）或控制台登录后的短期 JWT。
3. 默认 API：`https://cl.qzsyzn.com/api`（可用 `HA_API_BASE` 覆盖）。

```bash
curl -fsS -H "Authorization: Bearer $HA_AGENT_TOKEN" "${HA_API_BASE:-https://cl.qzsyzn.com/api}/me"
```

列表 `{data,total}`。错误 `{error}`：400 / 401 / 403 / 404 / 409。

完整接口表：[api-reference.md](api-reference.md)。工作流：[workflows.md](workflows.md)。

生成这些文件的源模板在 `internal/agentpack/embed/`。改操作说明时改模板，并同步本目录。
