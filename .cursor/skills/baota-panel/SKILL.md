---
name: baota-panel
description: >-
  Operates the production Baota (宝塔) panel on 42.193.236.123 via API:
  DNSPod A records, site ensure, reverse proxy to ha-api, Let's Encrypt SSL.
  Use when the user mentions 宝塔, Baota, DNS 解析, 反代, SSL/证书, cl.qzsyzn.com
  站点配置, or production edge on 42 — do not hand-edit nginx vhost files.
---

# 宝塔面板操作（生产 42）

**先读** [`.cursor/rules/prod-runtime-baota.mdc`](../../rules/prod-runtime-baota.mdc)。  
脚本入口：[`deploy/prod/baota_api.py`](../../../deploy/prod/baota_api.py)。  
凭据：`docs/credentials.local.md` 中 `HA_BT_PANEL` / `HA_BT_KEY`（勿打印密钥全文）。

## 何时用本 skill

- 给 `cl.qzsyzn.com` / `*.cl.qzsyzn.com` 加 DNS、开反代、申请证书
- 「用宝塔 API」代替手改 Nginx / 域名商网页
- 排查 42 上站点与 `127.0.0.1:18082` 是否打通

## 禁止

- ❌ 手工改 `/www/server/panel/vhost/nginx/*.conf` 后不经面板
- ❌ 把 API Key / 腾讯云 Secret 写进 Git
- ❌ 在 110 Hub 上配业务 HTTP 反代

## 认证（每次请求）

```
request_time = unix 秒
request_token = md5(request_time + md5(HA_BT_KEY))
POST application/x-www-form-urlencoded 到 HA_BT_PANEL + path
```

面板根：`http://42.193.236.123:8888`（**不要**把安全入口路径拼进 API URL）。  
API IP 白名单须含调用机（当前面板可为 `*`）。

## 一键命令（优先）

```bash
export HA_BT_PANEL=http://42.193.236.123:8888
export HA_BT_KEY=…   # credentials.local.md

python deploy/prod/baota_api.py ping
python deploy/prod/baota_api.py ensure-dns --domains 'cl.qzsyzn.com,*.cl.qzsyzn.com'
python deploy/prod/baota_api.py ensure-site --domain cl.qzsyzn.com --path /www/wwwroot/cl.qzsyzn.com
python deploy/prod/baota_api.py ensure-proxy --domain cl.qzsyzn.com --target http://127.0.0.1:18082
python deploy/prod/baota_api.py ensure-ssl --domain cl.qzsyzn.com
# 或：
python deploy/prod/baota_api.py setup-cl
```

## API 速查（已验证）

| 目的 | Path | 要点 |
|------|------|------|
| 探测 | `/system?action=GetSystemTotal` | ping |
| 站点列表 | `/data?action=getData` | `table=sites` |
| 建站 | `/site?action=AddSite` | `webname` JSON；path=`/www/wwwroot/<domain>` |
| 反代 | `/site?action=CreateProxy` / `ModifyProxy` | `proxysite=http://127.0.0.1:18082`；先 `GetProxyList` |
| DNS A 记录 | `/plugin?action=a&name=dnspod&s=create_record_bysite` | `domains=JSON 列表`；值=面板本机公网 IP；需 DNSPod 插件+腾讯云密钥 |
| 申请证书 | `/acme?action=apply_cert_api` | `auth_type=http`；**DNS 须已指向 42** |
| 挂载证书 | `/site?action=SetSSL` | `type=1` + `key`/`csr` PEM；申请成功后常需再调一次 |
| 强制 HTTPS | `/site?action=HttpToHttps` | `siteName=` |

DNSPod 插件其它方法（同 `name=dnspod&s=`）：`create_record`、`get_record_list`、`get_domain_list`、`delete_record`。  
腾讯云密钥存在面板 `data/tencent.conf`（加密）；**不要**拷进仓库。

## 标准顺序（新域名上线）

1. `ensure-dns`（主域 + 需要的泛域）
2. `dig +short <domain> @223.5.5.5` 确认 → `42.193.236.123`
3. `ensure-site` → `ensure-proxy` → `ensure-ssl`（内含 SetSSL + HttpToHttps）
4. 验收：`curl -fsS https://<domain>/healthz`

## 已知坑

| 现象 | 处理 |
|------|------|
| ACME「域名无效 / 验证失败」 | DNS 未生效或未指到 42；先 ensure-dns 再等解析 |
| 证书申请成功但 HTTPS 握手失败 | 再调 `SetSSL` 写入站点，然后 `HttpToHttps` |
| `CreateProxy` 重复名 | 先 `GetProxyList`，已存在则 `ModifyProxy` |
| Docker 建网 `ipset: exist` | compose 固定非冲突子网（生产用 `172.28.90.0/24`） |
| Windows 调远程 bash | 注意 CRLF；`sed -i 's/\r$//'` |

## 相关路径

- 站点根：`/www/wwwroot/cl.qzsyzn.com`
- Compose：`/www/wwwroot/cl.qzsyzn.com/docker`
- LE 证书缓存：`/www/server/panel/vhost/letsencrypt/<domain>/`
- 站点证书：`/www/server/panel/vhost/cert/<domain>/`
- 反代片段：`/www/server/panel/vhost/nginx/proxy/<domain>/`

更多字段说明见 [reference.md](reference.md)。
