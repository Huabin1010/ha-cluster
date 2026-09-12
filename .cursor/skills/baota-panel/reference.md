# 宝塔 API 参考（生产 42）

## create_record_bysite

`POST /plugin?action=a&name=dnspod&s=create_record_bysite`

```
domains = JSON 字符串，如 '["cl.qzsyzn.com","*.cl.qzsyzn.com"]'
```

行为：对每个 FQDN 用面板 `get_root_domain` 拆根域/子域，创建 **A 记录**，值为 `public.GetLocalIp()`（42 公网 IP）。  
成功示例：`{"status":true,"success":["cl","*.cl"],"error":{}}`。

记录已存在时 DNSPod 可能报错进 `error`；可改 `create_record` / `modify_record`。

## create_record（精细）

参数：`domain`（根域，如 `qzsyzn.com`）、`subDomain`（如 `cl` 或 `*.cl`，逗号分隔多条）、`recordType`、`recordLine`（通常`默认`）、`value`、`ttl`、`mx`。

## SetSSL

```
type=1
siteName=cl.qzsyzn.com
key=<privkey.pem 全文>
csr=<fullchain.pem 全文，可含中间证书>
```

`apply_cert_api` 返回里常有 `private_key` / `cert` / `root`；优先用返回值；否则读：

- `/www/server/panel/vhost/letsencrypt/<domain>/privkey.pem`
- `/www/server/panel/vhost/letsencrypt/<domain>/fullchain.pem`

## CreateProxy / ModifyProxy

常用字段：`proxyname`、`sitename`、`proxydir=/`、`proxysite=http://127.0.0.1:18082`、`todomain=$host`、`type=1`、`cache=0`。

控制台 WebSocket 依赖反代 Upgrade 头（面板创建反代时一般已带）。

## 与 ha-cluster 的边界

| 层 | 负责方 |
|----|--------|
| 公网 DNS A/AAAA、面板站点、TLS、到本机端口的反代 | **宝塔 API** |
| Ingress 公共域后缀、工作区子域审批、路由表 | **ha-api / 控制台** |
| Worker 纳管 | join token + Depot install |

不要用宝塔替代 `ingress_domain_zones`；宝塔只做门面。
