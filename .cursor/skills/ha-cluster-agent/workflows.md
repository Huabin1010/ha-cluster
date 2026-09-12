# 工作流（无密钥版）

鉴权与基址见 [SKILL.md](SKILL.md)。个性化 pack 会把 `{{API_BASE}}` / `{{TOKEN}}` 写进用户副本。

## 开通 2c2g

`GET /projects` → `POST /projects/{id}/workspaces` `{"name","plan":"2c2g","arch":"amd64"}` → 若 `requested` 则 owner/admin `POST /workspaces/{id}/approve` → 轮询至 `running`。

viewer 不能申请。`409 INSUFFICIENT_CAPACITY` 先清闲置机器。

## SSH

`GET /me/ssh-keys` → 没有就 `POST /me/ssh-keys`。`GET /workspaces/{id}/ssh-config`。无权限则 `POST /projects/{pid}/ssh-access-request`，admin `…/ssh-access/approve`。

## 拉人 / 邀请

`POST /projects/{id}/members` `{"username","role"}`（重复 409）。邀请按邮箱：`POST …/invitations`，`POST /invitations/accept` 必须邮箱匹配。转让：`POST …/transfer-ownership`。

## 公共域

`GET /ingress/meta` 取 `zone_id`。`POST /workspaces/{id}/ingress/shared` `mode=random|custom`。第二端口要 `confirm_second_port: true`。

## 销毁

`POST /workspaces/{id}/destroy-request` → 项目 `…/destroy-request/approve` → 平台 `POST /admin/dangerous-approvals/{id}/approve`。
