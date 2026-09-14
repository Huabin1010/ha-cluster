# 工作流（无密钥版）

鉴权与基址见 [SKILL.md](SKILL.md)。个性化 pack 会把 `{{API_BASE}}` / `{{TOKEN}}` 写进用户副本。

每次开干前：`GET /agent-pack/version`，与本地 [VERSION](VERSION) 比较；服务端更大则重拉 pack。

## 开通 2c2g（默认 Compose）

**默认这条。** `GET /projects` → `POST /projects/{id}/workspaces` `{"name","plan":"2c2g","arch":"amd64","runtime":"container"}` → 若 `requested` 则 owner/admin `POST /workspaces/{id}/approve` → 轮询至 `running`。机子里用 `docker compose` 部署。

仅当用户明确要 Kubernetes：同样路径加 `"runtime":"k8s"`（节点须带 `k3s`/`k8s`/`both`，否则 409）。**审批与 Docker 相同**（developer 待审，owner/admin 直建）。等 running 后 `POST /workspaces/{id}/k8s/apply` `{yaml}`，`GET …/kubeconfig`，`GET …/k8s/resources`。k8s 工作区不要走 exec。

viewer 不能申请。`409 INSUFFICIENT_CAPACITY` 先清闲置机器。

## 进机器（只走 HTTP）

`POST /workspaces/{id}/exec` `{"command":"uname -a"}` → `{exit_code,stdout,stderr}`。写文件用 `stdin_b64`。不要本机 `ssh` / ssh-config / 8099。只读 SSH 会 403。无权限则 `POST /projects/{pid}/ssh-access-request`，admin `…/ssh-access/approve`。

## 拉人 / 邀请

`POST /projects/{id}/members` `{"username","role"}`（重复 409）。邀请按邮箱：`POST …/invitations`，`POST /invitations/accept` 必须邮箱匹配。转让：`POST …/transfer-ownership`。

## 公共域

`GET /ingress/meta` 取 `zone_id`。`POST /workspaces/{id}/ingress/shared` `mode=random|custom`。第二端口要 `confirm_second_port: true`。`*.apps` 子域出厂即 HTTPS（平台通配符证书）。

## 推镜像 / 部署（默认 Compose + CNB）

先开/用 container 机器，`exec` 里 `docker compose up`。只有用户点名 k8s 才 `runtime=k8s` + apply。`GET /registries/preferred`。镜像路径 `docker.cnb.cool/<组织>/<仓库>:<标签>`。在机器里 `docker tag` / `docker push` / `docker pull` 走这条，不要默认 Docker Hub。控制台 https://cnb.cool。平台注入了 CNB 凭据则可直接用；否则用户自备令牌，或请 admin 在「镜像仓库」添加 `docker.cnb.cool` 并自动注入。

## HTTPS 证书（仅 platform_admin）

`GET /admin/tls-certs` → 看 `status` / `not_after`。立即签发或续期：`POST /admin/tls-certs/{id}/issue`（DNS-01，可能 1–3 分钟）。`PATCH /admin/tls-certs/{id}` `{"auto_renew":true}`。到期前 30 天后台自动续。列表不含私钥。不要随便给 `*.cl.qzsyzn.com` 点签发以免覆盖控制台证书。

## 销毁

`POST /workspaces/{id}/destroy-request` → 项目 `…/destroy-request/approve` → 平台 `POST /admin/dangerous-approvals/{id}/approve`。
