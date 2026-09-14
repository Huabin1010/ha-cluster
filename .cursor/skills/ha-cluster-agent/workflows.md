# 工作流（无密钥版）

鉴权与基址见 [SKILL.md](SKILL.md)。个性化 pack 会把 `{{API_BASE}}` / `{{TOKEN}}` 写进用户副本。

本会话：`GET /agent-pack/version` 一次、`GET /me` 一次。不要每个任务都把项目/机器/入口/仓库/exec 探活走一遍。Windows 用 `curl.exe`，JSON 写文件，禁止 `$pid` 当变量名。

## 更新已有服务（默认）

本机已 login CNB（看 `~/.docker/config.json` 的 `auths` / `credsStore`，或 `docker images`；**不要**用 `docker info` IndexConfigs）→ 本机 `docker build` && `docker push`。`GET /workspaces?project_id=` 跳过 destroyed，同名优先 `exec_ready=true` 的 running **id**。`exec_ready=true` 不必再 uname；`false` 则 `POST /start` 或换一台。通了只 `docker pull` + `run`/`compose up` + `docker logs`。`Restarting` / `permission denied` 先 chown 数据目录。域名没有才 `POST /ingress/shared`。**禁止 exec 传二进制。**

## 开通 2c2g（默认 Compose）

**默认这条。** `GET /projects` → 若 `purpose` 为空先 `PATCH /projects/{id}` `{purpose}`（看到 `409 PURPOSE_REQUIRED` 就停）→ 若没有项目则 `POST /projects` `{name,slug,purpose}`（purpose 必填、简洁）→ `POST /projects/{id}/workspaces` `{"name","plan":"2c2g","arch":"amd64","runtime":"container"}` → 若 `requested` 则 owner/admin `POST /workspaces/{id}/approve` → 轮询至 `running`。本机构建并推 CNB 后，机子里只 `docker pull` + `docker compose up`。

仅当用户明确要 Kubernetes：同样路径加 `"runtime":"k8s"`（节点须带 `k3s`/`k8s`/`both`，否则 409，error 会写明没有带标签的节点）。**审批与 Docker 相同**（developer 待审，owner/admin 直建）。等 running 后 `POST /workspaces/{id}/k8s/apply` `{yaml}`。缺 `resources.requests` 会 409 `conflict: …project-quota`，读 JSON 不要只报 Conflict。再 `GET …/k8s/status` 看副本/Pod；`warnings` 只表示当前代，旧 FailedCreate 在 `history`。k8s 工作区不要走 exec，也不要借 Docker 机当跳板。kubeconfig 若是 `https://k8s.invalid` 或 503 `K8S_UNAVAILABLE`，不要换字段重试。

viewer 不能申请。`409 INSUFFICIENT_CAPACITY` 先清闲置机器。

## 进机器（只走 HTTP）

`POST /workspaces/{id}/exec` `{"command":"uname -a"}` → `{exit_code,stdout,stderr}`。命令失败 HTTP 仍 200，看 `exit_code`。写小文件：`{"command":"cat > /tmp/note.txt","stdin_b64":"<BASE64>"}`（平台已解码，**不要** `base64 -d`）。不要本机 `ssh` / ssh-config / 8099。只读 SSH 会 403。无权限则 `POST /projects/{pid}/ssh-access-request`，admin `…/ssh-access/approve`。**构建只能在本机运行，不允许在我们申请的机器中运行。** exec 不要当传文件通道。

## 拉人 / 邀请

`POST /projects/{id}/members` `{"username","role"}`（重复 409）。邀请按邮箱：`POST …/invitations`，`POST /invitations/accept` 必须邮箱匹配。转让：`POST …/transfer-ownership`。

## 公共域

`GET /ingress/meta` 取 `zone_id`（领域名时才打）。`POST /workspaces/{id}/ingress/shared` `mode=random|custom`。第二端口要 `confirm_second_port: true`。保留前缀 `admin` / `api` / `auth` / `console`。非 `running` 不能 claim。`*.apps` 子域出厂即 HTTPS。

## 推镜像 / 部署（默认 Compose + CNB）

先在**本机** `docker build` 并 `docker push` 到 CNB，再用 container 机器 `exec` 里 `docker pull` + `docker compose up` + `docker logs`（禁止 `compose build`）。数据目录挂 `/root/...` 且镜像 `USER` 非 root 时先 chown。只有用户点名 k8s 才 `runtime=k8s` + apply。不确定仓库名才 `GET /registries/preferred`。镜像路径 `docker.cnb.cool/<组织>/<仓库>:<标签>`。不要默认 Docker Hub。平台注入了 CNB 凭据则可在机器里直接 pull；push 在本机做。

## HTTPS 证书（仅 platform_admin）

`GET /admin/tls-certs` → 看 `status` / `not_after`。立即签发或续期：`POST /admin/tls-certs/{id}/issue`（DNS-01，可能 1–3 分钟）。`PATCH /admin/tls-certs/{id}` `{"auto_renew":true}`。到期前 30 天后台自动续。列表不含私钥。不要随便给 `*.cl.qzsyzn.com` 点签发以免覆盖控制台证书。

## 销毁

`POST /workspaces/{id}/destroy-request` → 项目 `…/destroy-request/approve` → 平台 `POST /admin/dangerous-approvals/{id}/approve`。
