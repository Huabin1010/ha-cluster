---
name: onboard-domain
description: >-
  Platform-admin playbook for domains on ha-cluster: add a public apps suffix,
  set up or change the CNAME base for user-owned domains (HA_INGRESS_CNAME_TARGETS),
  and troubleshoot why a user's custom domain (verify_kind=cname) is not live.
  Use when the user mentions 接入域名, 新增域名后缀, 自有域名, CNAME, 域名没生效,
  证书没签下来, edge.cl.qzsyzn.com, or HA_INGRESS_CNAME_TARGETS.
---

# 域名接入与排查（平台管理员）

先读：[`docs/implementation/25-ingress-portforward-dns.md`](../../../docs/implementation/25-ingress-portforward-dns.md) §3.2、
[`.cursor/rules/ingress-edge.mdc`](../../rules/ingress-edge.mdc)、[`baota-panel`](../baota-panel/SKILL.md)。
宝塔一律走 API（[`deploy/prod/baota_api.py`](../../../deploy/prod/baota_api.py)），不手改 vhost。
凭据只在 `docs/credentials.local.md`，不打印、不写进 Git。

**改生产（DNS、`.env`、发布、删站点）前先向用户确认。**

## 三种域名，先分清

| 类型 | 例子 | 谁配 DNS | 审批 | HTTPS |
|---|---|---|---|---|
| 公共后缀 | `xxx.apps.cl.qzsyzn.com` | 平台泛解析 | 免审 | 平台通配符证书 |
| 用户自有域（CNAME） | `app.customer.com` | 用户加一条 CNAME | 免审，DNS 校验通过即生效 | 宝塔按域名签 Let's Encrypt |
| 平台非公共后缀 / 不带 `verify_kind` 的自有域 | `vip.cl.qzsyzn.com` | 平台 | owner/admin 审批 | 视情况 |

自有域的 CNAME 记录值是**每条路由独有**的：`r-<路由 UUID 前 10 位 hex>.<base>`，
`base` = `HA_INGRESS_CNAME_TARGETS` 第一项。所以 `*.<base>` 必须泛解析到 42。
只指向 `<base>` 本身会被判为 `wrong_target`（防止别人抢注已指向平台的域名）。

## 场景 A：新增公共域后缀

1. 宝塔 DNSPod 泛解析：`python deploy/prod/baota_api.py ensure-dns --domains '*.apps2.example.com'`
2. 登记后缀：`POST /admin/ingress-domains` `{"suffix":"apps2.example.com","display_name":"…","require_approval":false,"allow_random":true,"allow_custom_prefix":true}`
3. 控制台「平台 → 域名配置」对该后缀点「立即签发」通配符证书，等 `issued`。
4. 验收：在某台 running 机器上领一个随机子域，`curl -I https://<sub>.apps2.example.com`。

## 场景 B：首次开启或更换 CNAME base

1. DNS（42 的公网 IP `42.193.236.123`）：
   `python deploy/prod/baota_api.py ensure-dns --domains 'edge.cl.qzsyzn.com,*.edge.cl.qzsyzn.com'`
   然后 `dig +short r-test.edge.cl.qzsyzn.com @223.5.5.5` 应返回 42。
2. 42 上 `/www/wwwroot/cl.qzsyzn.com/docker/.env`：
   ```
   HA_INGRESS_CNAME_TARGETS=edge.cl.qzsyzn.com
   HA_EDGE_PROVIDER=baota          # noop 则只开 HTTP，不签证书
   HA_BT_EDGE_TARGET=http://127.0.0.1:18080
   ```
   `HA_BT_PANEL` / `HA_BT_KEY` 必须已配（容器内访问面板）。
3. 按 `deploy-prod` skill 滚动发布（本机构建 → push CNB → 42 pull → `rolling-up.sh`）。
4. 验收：`curl -s https://cl.qzsyzn.com/api/ingress/meta` 中 `cname_enabled=true`、`cname_base` 正确、`edge_provider=baota`。

**更换 base**：老路由的记录值会跟着变。先把新旧都写进 `HA_INGRESS_CNAME_TARGETS`
不能解决（只用第一项生成记录值）；要通知已有用户改 CNAME，或保留旧泛解析直到用户迁完。
active 路由 CNAME 不对时只记 `dns_error`，不会自动删除。

## 场景 C：某个自有域为什么没生效

按顺序查，前一步不过就停下处理：

1. 路由本身：`GET /workspaces/{ws}/ingress` 找到该域名，看 `status`、`dns_code`、`dns_error`、`cname_target`、`tls_status`、`tls_error`。
2. DNS：`dig +short CNAME app.customer.com @223.5.5.5`，应等于 `cname_target`。

   | `dns_code` | 含义 | 处理 |
   |---|---|---|
   | `not_found` | 还没解析到 | 等 1–10 分钟；确认用户加在正确的 zone |
   | `wrong_target` | 指向别处或只指向 base | 让用户把记录值改成 `cname_target` |
   | `proxied` | Cloudflare 橙云等 CDN 代理 | 改为「仅 DNS」 |
   | `apex` | 根域 | 改用子域 |
   | `lookup_error` | 公共 DNS 查询失败 | 稍后自动重试；可改 `HA_INGRESS_DNS_SERVERS` |
   | `no_target` | 平台没配 base | 做场景 B |

3. 点「立即检测」或 `POST /ingress/{id}/verify`，状态应变 `active`。`pending_dns` 超过 72 小时会被自动清理，需要用户重新添加。
4. HTTP：`curl -I -H 'Host: app.customer.com' http://127.0.0.1:18080`（在 42 上）应到达工作区服务；不通则查 edge nginx 的 `/etc/nginx/ha-ingress/` 是否有该域名的 conf、工作区端口是否在监听。
5. HTTPS：`tls_status`
   - `skipped`：`HA_EDGE_PROVIDER` 是 `noop`，只有 HTTP。
   - `failed`：看 `tls_error`。常见是 DNS 刚生效、Let's Encrypt 频率限制、宝塔站点 80 口不通。修好后「立即检测」会重试签发。
   - 宝塔侧：`python deploy/prod/baota_api.py add-domain --domain app.customer.com` 可手工补建站点 + 反代 + 证书（与 ha-api 行为一致，站点名=域名，反代名 `ha-edge`）。
6. 收尾删除：用户在控制台删路由时 ha-api 会删宝塔站点；残留时用 `remove-domain --domain …`（先确认）。

## 相关代码

- DNS 校验：`internal/ingress/cname.go`（`VerifyCNAMEStrict`、`RouteTargetLabel`）
- 生命周期 / 后台复查：`internal/service/ingress_cname.go`、`background.go`
- 入口实现：`internal/edge/`（`BaotaEdge`、`NoopEdge`；新增入口机只需实现 `CustomDomainEdge`）
- 前端：`web/src/pages/workspaces/CustomDomainCard.tsx`、`web/src/lib/custom-domain.ts`
