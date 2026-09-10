# 25 · 反向代理、端口转发与域名（公共 / 特殊 + 云 DNS）

> 上级索引：[00-index.md](00-index.md)  
> 关联：[19-resource-allocation-ssh-and-ingress-design.md](19-resource-allocation-ssh-and-ingress-design.md)、[23-ingress-fabric-topology.md](23-ingress-fabric-topology.md)  
> 文档性质：**产品概念定稿**（用户自配暴露、域名分级、腾讯云/阿里云 DNS 快速配置）

---

## 1. 用户要配的两类暴露

| 类型 | 用户语言 | 平台术语 | 典型用途 |
|------|----------|----------|----------|
| **反向代理** | 绑域名访问网站/API | `IngressRoute`（HTTP/HTTPS） | Web、REST、WebSocket（走 443） |
| **端口转发** | 把公网端口转到机器里 | `PortForward`（TCP 四层） | 数据库、游戏服、自定义 TCP、非 HTTP 协议 |

两者都经 **入口机** 公网 IP 进入，再经 **调度 Relay → EasyTier → Worker**（见 [23](23-ingress-fabric-topology.md)）。用户在工作区详情页 **自行配置**，无需 SSH 改 Nginx。

```
用户浏览器 / 客户端
    │ HTTPS :443 或 TCP :<public_port>
    ▼
入口机（TLS / stream）
    ▼
Relay 池
    ▼
Worker fabric_ip : host_port  →  Workspace 内服务
```

---

## 2. 反向代理（用户自配）

### 2.1 已有能力（代码基线）

工作区 **网络 / 暴露** 页（`Machine.tsx`）可配置：

| 字段 | 说明 |
|------|------|
| `domain` | 完整域名或子域 |
| `path` | 路径前缀，默认 `/` |
| `port` | 工作区 **容器内** 监听端口（如 8080） |
| `preset` | `nocache` / `transparent` / `cache` |
| `extra_nginx` | 用户自定义片段（经 `SanitizeExtra` 过滤） |

生效后 `ha-agent` `ExposePort` 映射 `host_port`，入口/Relay Nginx `proxy_pass` 到 `fabric_ip:host_port`。

### 2.2 用户可理解的配置项（产品文案）

- **对内端口**：Workspace 里进程监听的端口（如 `8080`）。
- **对外域名**：见 §3（公共域免审 / 特殊域审批）。
- **代理模式**：开发调试选「透明」；静态站选「短缓存」。
- **高级**：可选额外 Nginx 指令（禁止 `server`/`include` 等破坏配置的指令）。

---

## 3. 域名分级：公共域 vs 特殊域

### 3.1 公共域名（免申请，直接选用）

平台持有 **泛解析已生效** 的公共后缀，用户 **无需审批** 即可领取子域：

| 项 | 示例 |
|----|------|
| 泛域名 | `*.apps.<platform-domain>` |
| 用户领取 | `{前缀}.apps.<platform-domain>` |
| DNS | **已** A/泛解析到入口机；用户 **不用** 去云厂商改 DNS |
| 状态 | 创建即 `active`（或 `pending_dns` 仅当需自动写子域记录时） |
| 保留词 | `api`、`admin`、`bastion` 等仍禁止（见 `ingress.ReservedSubdomains`） |

**领取规则：**

- 项目内 `developer+` 在工作区选「使用公共域名」→ 输入合法前缀 → 立即生成路由。
- 前缀全局唯一；冲突返回 409。
- 证书：入口机 **通配符证书** `*.apps.<platform-domain>` 已覆盖。

### 3.2 特殊域名（须申请审批）

以下视为 **特殊域**，走 **申请 → owner/admin 审批**（与现有 `pending_approval` 一致）：

| 类型 | 示例 | 为何特殊 |
|------|------|----------|
| **用户自有顶级/独立域** | `app.customer.com` | 需 DNS 归属校验、防撞车 |
| **平台非公共后缀** | `vip.<platform-domain>` | 运营保留 |
| **短前缀 / 敏感词** | 非公共池内的任意 FQDN | 风控 |

审批通过后：`active` → `ExposePort` → Nginx 热重载。

| 角色 | 创建特殊域路由 |
|------|----------------|
| developer | `pending_approval` |
| owner / admin | 可直接 `active` |
| platform_admin | 可直接 `active` |

### 3.3 对照表

| | 公共域名 | 特殊域名 |
|---|----------|----------|
| 是否审批 | **否** | **是**（developer 须审） |
| DNS 谁配 | 平台泛解析已就绪 | 用户域名 + **可选** 云 DNS 一键配置（§5） |
| 证书 | 平台通配符 | 用户域：DNS-01 / 手动上传 / 平台代签（二期） |
| API 字段建议 | `domain_tier: shared` | `domain_tier: custom` |

---

## 4. 端口转发（TCP，用户自配）

HTTP 走 §2；**非 HTTP** 或需 **固定公网 TCP 端口** 时用端口转发。

### 4.1 配置模型（建议）

```json
{
  "workspace_id": "uuid",
  "name": "postgres",
  "protocol": "tcp",
  "public_port": 15432,
  "target_port": 5432,
  "status": "pending_approval | active | rejected"
}
```

| 字段 | 说明 |
|------|------|
| `public_port` | 入口机监听的公网端口（平台分配或从池中选取） |
| `target_port` | Workspace 内服务端口 |
| `protocol` | 首期 `tcp`；`udp` 二期 |

### 4.2 数据路径

入口机 **stream {}**（Nginx）或专用 `ha-portfwd`：

```
client → entry:public_port → relay → worker:host_port → container:target_port
```

### 4.3 审批

与特殊域名相同：**developer 申请**，**owner/admin 批准**。  
公共池 **固定端口段**（如 `15000–15999`）可配置为免审（可选策略）。

> **实现状态：** 反向代理已有；**TCP PortForward 表结构与 stream 配置待实现**。

---

## 5. 腾讯云 / 阿里云 DNS 快速配置

用户绑定 **特殊域名**（自有域）时，引导在 DNSPod / 阿里云解析一键指向平台入口。

### 5.1 支持的厂商（P1）

| 厂商 | API | 凭证（仅存平台或用户加密库） |
|------|-----|------------------------------|
| **腾讯云 DNSPod** | [DNSPod API](https://docs.dnspod.cn/api/) | `SecretId` + `SecretKey` 或 API Token |
| **阿里云云解析** | [Alidns API](https://help.aliyun.com/document_detail/29739.html) | `AccessKeyId` + `AccessKeySecret` |

凭证写入 `docs/credentials.local.md` 或控制台「DNS 集成」；**禁止进 Git**。

### 5.2 用户流程

```
1. 工作区 → 添加特殊域名 → 输入 app.customer.com
2. 选择 DNS 提供商：腾讯云 / 阿里云 / 手动
3. 若选云厂商：
     a. 用户授权（AK/SK 或 OAuth，二期）或使用平台托管子账号
     b. 选择已有域名 zone：customer.com
     c. 一键「创建记录」：A 或 CNAME → 入口公网 IP / 入口 CNAME
4. 平台轮询解析是否生效（DNS 探针，可选 pending_dns 状态）
5. owner/admin 审批 → active → 流量打通
```

### 5.3 平台侧记录建议

| 记录类型 | 值 | 说明 |
|----------|-----|------|
| **A** | `HA_INGRESS_PUBLIC_IP`（如 `110.40.229.62`） | 最简 |
| **CNAME** | `ingress.<platform-domain>` | 入口 IP 变更时少改用户域 |

TTL 建议 60s 便于切换；生效后状态 `pending_dns` → `active`。

### 5.4 服务模块（建议）

```
internal/dns/
  provider.go      # interface: UpsertRecord, DeleteRecord, CheckPropagation
  tencent.go       # DNSPod
  aliyun.go        # Alidns
```

环境变量（平台级，用于代管公共域子域可选）：

```bash
HA_DNS_TENCENT_SECRET_ID=...
HA_DNS_TENCENT_SECRET_KEY=...
HA_DNS_ALIYUN_ACCESS_KEY_ID=...
HA_DNS_ALIYUN_ACCESS_KEY_SECRET=...
HA_INGRESS_PUBLIC_IP=110.40.229.62
HA_INGRESS_SHARED_ZONE=apps.mnnumath.vip
```

用户级凭证（特殊域）：表 `dns_credentials`（加密 `secret`，绑定 `user_id` 或 `project_id`）。

### 5.5 安全

- AK/SK 仅用于 **指定 zone** 的 **指定记录** CRUD；不做全账号权限。
- 审计：`dns.record.create` / `dns.verify`。
- 解析未生效前路由可保持 `pending_dns`，避免误指。

---

## 6. 控制台交互（摘要）

工作区 **网络暴露** 页分 Tab：

| Tab | 内容 |
|-----|------|
| **公共域名** | 前缀输入 → 即时 `xxx.apps.xxx`；复制访问 URL |
| **特殊域名** | FQDN + 云 DNS 向导 / 手动 A 记录说明 + 提交审批 |
| **反向代理** | 路径、对内端口、preset、高级 Nginx（已有） |
| **端口转发** | TCP 公网端口 ↔ 对内端口 + 审批 |

管理员：**待审批** 列表合并「特殊域名 + 端口转发」。

---

## 7. API 契约（建议扩展）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/ingress/meta` | 增加 `shared_zone`、`shared_suffix`、DNS 厂商列表 |
| POST | `/workspaces/{id}/ingress/shared` | 领取公共子域（免审） |
| POST | `/workspaces/{id}/ingress` | 特殊域（现有，带 `domain_tier=custom`） |
| POST | `/workspaces/{id}/port-forwards` | 申请 TCP 转发 |
| POST | `/dns/verify` | 探针解析是否指向入口 |
| POST | `/dns/tencent/records` | 腾讯云创建记录 |
| POST | `/dns/aliyun/records` | 阿里云创建记录 |

`IngressRoute` 建议字段：

| 字段 | 说明 |
|------|------|
| `domain_tier` | `shared` \| `custom` |
| `dns_provider` | `manual` \| `tencent` \| `aliyun` |
| `dns_record_id` | 云厂商记录 ID（便于删除） |
| `exposure_kind` | `http_proxy` \| `tcp_forward` |

---

## 8. 与现有实现的关系

| 能力 | 现状 | 本文拍板 |
|------|------|----------|
| HTTP 反向代理 + Nginx 模板 | ✓ | 保持 |
| 用户填 domain/port/preset/extra | ✓ `Machine.tsx` | 保持 |
| 特殊域 `pending_approval` | ✓ `ingress.go` | 保持 |
| **公共域免审领取** | ✗ 用户仍填完整 FQDN | **新增** `POST …/ingress/shared` |
| **端口转发 TCP** | ✗ | **待实现** |
| **腾讯云/阿里云 DNS API** | ✗ | **待实现** `internal/dns` |
| DNS 生效探针 `pending_dns` | 模型有常量，未全用 | 特殊域 + 自有域启用 |

---

## 9. 验收清单

- [ ] 用户领取 `foo.apps.<platform>` **无需审批** 即可 HTTPS 访问  
- [ ] 用户提交 `app.customer.com` 须审批；驳回不生效  
- [ ] 腾讯云一键创建 A 记录指向入口 IP；60s 内探针通过  
- [ ] 阿里云同上  
- [ ] 用户配置 TCP 端口转发，审批后公网端口可达 Workspace 内服务  
- [ ] 公共域保留词 `admin.apps.*` 被拒绝  
- [ ] 所有业务 DNS 最终仍只解析到 **入口机**（非 worker 公网 IP）  

---

## 10. 文档关系

- 入口三层拓扑：[23-ingress-fabric-topology.md](23-ingress-fabric-topology.md)  
- Nginx 审批与模板：[19-resource-allocation-ssh-and-ingress-design.md](19-resource-allocation-ssh-and-ingress-design.md) §5  
- 工程规范：[21-core-pipeline-spec.md](21-core-pipeline-spec.md) §5  
