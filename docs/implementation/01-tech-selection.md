# 01 · 技术选型

> 上级：[00-index.md](00-index.md)  
> 相关：设备能力见 [inventory.md](../inventory.md)

---

## 1. 选型原则

1. **适配异构与脆弱节点**：控制面常驻市电机器（现为 VPS）；worker 可以是 **amd64 主机或 arm64 设备**，后者可随时 NotReady。
2. **用户体验优先「真机感」**：独立 SSH、root/sudo、包管理，而不是只能提交 YAML。
3. **资源语义硬占用**：编排层之前必须有可审计的账本。
4. **amd64 与 arm64 同为一等公民**：安装、镜像、调度、账本池均按架构切开；禁止默认可疑的 qemu 混跑。
5. **加节点必须快且笨**：一个包 + root 密码；依赖走 Depot/离线 payload，不靠现场公网零散下载。
6. **运维成本可控**：单人也能维护；优先静态二进制、少依赖宝塔。
7. **安全默认**：跳板统一入口、最小暴露面、会话可审计；bootstrap 密码不落库。

---

## 2. 总决策一览

| 领域 | 选型 | 备选 | 不做（近期） |
|------|------|------|--------------|
| 容器编排（无状态/CI） | **k3s** | k0s | kubeadm 全量 |
| Workspace 运行时 | **Incus / LXD 系统容器** | Kata（有硬件时） | 默认 KubeVirt |
| 资源账本 | **PostgreSQL + 乐观锁/事务** | SQLite（单机 MVP） | 仅靠 ResourceQuota |
| 用户与 API | **Go `ha-api`**（chi + pgx + 事务账本） | FastAPI | 每功能一个微服务 |
| 前端控制台 | **Refine + Vite + React**（UI：shadcn） | `@refinedev/antd` | Next.js 版 Refine、Ant Design Pro |
| SSH 跳板 | **Teleport 开源** 或自研 **sshd + ForceCommand** | Apache Guacamole（Web） | 用户直连手机 22 |
| 节点安装 | **ha-setup + 按 arch 的 payload + Depot** | Ansible 仅内部 | 每台手工 apt/curl |
| 节点互联 | **EasyTier overlay（VPS 自建中继）** | Tailscale / 纯 WG | 依赖手机公网 IP；集群走 NPS 逐条隧道 |
| 节点隧道（遗留） | NPS 仅宝塔/旧站点 | — | 新集群流量走 NPS |
| 入口 TLS | **OpenResty（现网）** + Ingress | Traefik on VPS | NPS 占 80/443 |
| 镜像仓库 | Depot + VPS registry | Harbor（过重） | 每节点直拉 Docker Hub |
| 机密 | age/sops + 本机 credentials | Vault（二期） | Git 存密码 |
| 监控 | metrics-server + 节点导出 | Prometheus 精简 | 全家桶一上来 |

---

## 3. 编排层：为什么是 k3s

| 选项 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **k3s** | 单二进制、arm64、server/agent 分离、内存友好 | 默认 Flannel 在 NAT 后不稳 | **采用** |
| k0s | 类似 | 生态与资料略少 | 备选 |
| RKE2 | 偏生产加固 | 偏重 | 不做 |
| Nomad | 轻 | 不是 k8s 语义 | 不做 |
| 纯 Docker/Compose | 简单 | 无统一配额/调度/HA 语义 | 仅节点引导用 |

**职责划分：**

- k3s：**平台自身组件**（Ingress 控制器、registry 代理、监控、可选无状态应用）与「项目内 Deployment 模式」。
- Incus/LXD：**用户可 SSH 的 Workspace**（真机感主路径）。
- 账本服务：两者创建前的**唯一配额真相源**。

> 仅用 k8s ResourceQuota **不够**：它管的是 ns 内 requests，不跨 LXD、不防「控制台重复点创建」、不天然对接用户账单。必须有独立 Ledger。

---

## 4. Workspace 运行时对比

用户要求：**像操控真实虚拟机**，且**资源占用后不可再分**。

| 方案 | 像虚机程度 | 隔离强度 | 内存开销 | 手机可行性 | 硬 cgroup 限制 | 结论 |
|------|------------|----------|----------|------------|----------------|------|
| 共享主机多用户 SSH | 低 | 弱 | 最低 | 高 | 弱 | **禁止**作多租户 |
| Docker 特权容器 + sshd | 中 | 中 | 低 | 高 | 可以 | MVP 可，长期不如系统容器 |
| **Incus/LXD 系统容器** | **高**（systemd、多进程） | 较强 | 低–中 | **高** | **原生** | **P1 主选** |
| Kata / Firecracker | 很高 | 很高 | 中–高 | 需嵌套/KVM | 是 | P3，硬件允许时 |
| KubeVirt 全虚机 | 最高 | 最高 | 高 | **当前手机不适合** | 是 | 非主路径 |
| vCluster | 像「小集群」不像 Linux 机 | 中 | 中 | 紧 | 靠下层 | 可选给高级用户 |

### 4.1 P1 推荐：Incus（LXD 后继）系统容器

- 每 Workspace 一个实例：`ubuntu:24.04`（或 22.04）**与节点同架构** 镜像。
- 配置：`limits.cpu`、`limits.memory`、`limits.disk` —— 与账本套餐对齐。
- 内装 `openssh-server`；只监听节点本地或 overlay IP，**不对公网**。
- 可选：云初始化注入用户公钥、hostname=`ws-<id>`。

### 4.2 与 k3s 同机共存

手机上可同时跑 k3s-agent + incus；**x86 主机同样如此**。有 `/dev/kvm` 时额外允许微虚机套餐（P3）。

注意内存：phone1 仅 ~2.6 Gi，**系统预留 + agent + 至少一个 Workspace** 必须进账本容量模型。x86 桌面有 GUI 时预留更大，见 [11](11-node-profiles.md)。

若某节点只适合跑一种：标签 `ha-cluster/runtime=incus|k3s|both`。

---

## 5. 用户系统与 API

### 5.1 身份

| 阶段 | 方案 |
|------|------|
| MVP | 本地账号：邮箱/用户名 + Argon2id 密码；JWT access + refresh |
| 二期 | OIDC（GitHub / 自建 Keycloak / Authelia） |
| 运维 | 平台管理员 TOTP / WebAuthn |

### 5.2 API 服务（已拍板）

独立服务 **`ha-api`**，与 `ha-setup` / `ha-agent` **同一 Go module**（`github.com/.../ha-cluster`），交叉编译出 amd64/arm64 单文件。

| 层 | 选型 | 说明 |
|----|------|------|
| 语言 | **Go 1.23+** | 和安装器、agent 同语言；VPS 上一个 systemd 单元 |
| HTTP | **chi** | 轻、中间件清晰；不用 Gin 全家桶 |
| DB | **PostgreSQL 16** + **pgx/v5** | 账本必须显式事务 / `SELECT FOR UPDATE` |
| 迁移 | **golang-migrate** | SQL 文件进仓库 |
| 鉴权 | JWT（access 短 + refresh 旋转）+ Argon2id | 见 [03](03-user-management.md) |
| API 契约 | **OpenAPI 3** | Refine `dataProvider` 对接；禁止为迁就 Inferencer 改账本语义 |
| 后台任务 | 同进程 worker + `LISTEN/NOTIFY` 或表轮询 | 二期再上 Redis/Asynq |
| 日志 | slog JSON | 禁止打密码、token |

**不采用 FastAPI 的原因：** 本仓库已经需要 Go 静态二进制（agent/setup）；再养一套 Python 运行时、venv、arm 交叉，不划算。账本事务用 pgx 比 ORM 更不容易超卖。

CLI **`hactl`**：同一 module 里的小前端，调同一 OpenAPI，给 M1–M2 在 SPA 未完成时用。

目录：

```
api/          ha-api
agent/        ha-agent
packaging/    ha-setup
web/          Refine 控制台（Vite SPA）
internal/     共享：auth、db、fabric 接口
```

### 5.3 为何不第一期上完整 Keycloak

节点与人力有限；本地用户 + JWT 足够 M3。预留 `identity_provider` 字段便于后接 OIDC。

---

## 6. 跳板（Bastion）选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **Teleport（OSS）** | RBAC、录制、证书短时、成熟 | 组件多，要学 | **推荐二期标准** |
| **自研：VPS sshd + AuthorizedKeysCommand + ForceCommand proxy** | 轻、贴现网 NPS | 要自己做审计与 ACL | **MVP 可用** |
| Guacamole | 浏览器远控 | 偏 RDP/VNC，SSH 体验一般 | 可选 Web 通道 |
| 用户直连 NPS 映射的 809x | 已有 | 无统一身份、难协作、难审计 | **仅管理员紧急通道** |

MVP 路径：

```
用户 ssh -i key alice@bastion.mnnumath.vip
  → ForceCommand: ha-bastion-proxy --user alice
  → 交互选择或 sshd 子系统指定 workspace
  → 经 EasyTier 拨 10.88.0.x 上的 workspace:22
```

详见 [06-bastion-routing.md](06-bastion-routing.md)。

---

## 7. 网络与隧道

| 层 | 选型 |
|----|------|
| 公网 HTTPS | OpenResty 终结 TLS（现网） |
| 用户 SSH | Bastion 在 VPS（或专用口，勿占 80/443） |
| **集群底盘** | **EasyTier**：全节点 `10.88.0.0/16`；VPS 为中继（UDP/TCP/WSS 11010/11011） |
| k3s agent → API | `https://10.88.0.1:6443`（**不对公网**开放 6443） |
| 安装制品 | Depot `http://10.88.0.1:9090`（overlay 内）；payload 按 arch |
| 节点互联 | overlay 上承诺虚 IP 互通；打洞失败则 VPS 中继 |
| 遗留站点 | NPS `8088–8097` 不动；**新流量不走 npc** |

---

## 8. 存储选型

| 数据 | 放哪 | 说明 |
|------|------|------|
| 用户/账本/审计 | VPS PostgreSQL | 可备份；可上云盘快照 |
| Workspace 根盘 | 所在节点本地 zfs/dir 存储池 | **不随迁移漂移**；迁移=重建或 rsync |
| 对象/共享文件 | VPS MinIO 或目录 | 项目级共享盘挂载（二期） |
| etcd/k3s | 控制面本地 + 定时快照 | **禁止放手机**；市电 x86 二期可作第二 server |

---

## 9. 前端与「远程 IDE」（已拍板）

**控制台 `ha-web` 基于 [Refine](https://github.com/refinedev/refine)（Vite SPA），不用 Next.js。**

Refine 提供后台的资源、权限、列表骨架；UI 用官方 **shadcn 适配**；接口用 **自写 `dataProvider` / `authProvider`** 对接 Go `ha-api`。构建仍是 `vite build` → 静态文件，OpenResty 托管，`/api` 同源反代。

仓库：<https://github.com/refinedev/refine>

### 9.1 栈

| 层 | 选型 | 说明 |
|----|------|------|
| 应用框架 | **Refine**（`@refinedev/core`） | 资源 CRUD、路由约定、鉴权、权限、通知 |
| 构建 | **Vite** + React 19 + TypeScript | `npm create refine-app@latest` 选 **Vite**，不要选 Next |
| 路由 | **`@refinedev/react-router`** + React Router | 客户端路由 |
| UI | **`@refinedev/shadcn`** + Tailwind | 列表/表单/布局；暗色 |
| 数据 | **自写 `dataProvider`** | 映射到 ha-api；不用 `simple-rest` 硬套账本 |
| 登录 | **自写 `authProvider`** | JWT access/refresh，见 [03](03-user-management.md) |
| 权限 | **`accessControlProvider`** | 平台角色 + 项目 RBAC |
| 通知 | Refine notification + shadcn toast | 创建失败、`409 INSUFFICIENT_CAPACITY` |
| 轮询 | Refine `useList` + `refetchInterval` | 节点 / Fabric 状态 |

脚手架：

```bash
npm create refine-app@latest ha-web
# 选：Vite · TypeScript · REST（随后换成自定义 provider）· shadcn
```

### 9.2 资源怎么映射（改造要点）

Refine 的 `resources[]` 对的是「能 list/show/create/edit」的东西。本平台 **不是** 把数据库表直接暴露成 JSON-REST，账本语义必须留在 Go 里。

| Refine resource | ha-api | 说明 |
|-----------------|--------|------|
| `projects` | `/projects` | 标准 list/create/edit |
| `memberships` | `/projects/:id/members` | 嵌套资源 |
| `workspaces` | `POST /projects/:id/workspaces` | **create 必须走账本扣减**；409 原样展示 |
| `nodes` | `/nodes` 或 `/capacity` | 只读 + 封锁；无租户 create |
| `ssh-keys` | `/me/ssh-keys` | 当前用户 |
| `audit-logs` | `/audit-logs` | 只读 |

**禁止** 用 Inferencer 自动生成「直接改 Allocation 数字」的 Edit 页。占用只能通过创建/销毁 Workspace 或管理员强制释放。

自定义页面（不必塞进标准 CRUD）：

- 创建 Workspace：先看 `/usage` 再提交套餐 + arch  
- 节点与 Fabric：`fabric_degraded` / RTT / p2p\|relay  
- 下载 SSH config：按钮出文件  

`dataProvider.create("workspaces")` → `POST /projects/{id}/workspaces`；`409 INSUFFICIENT_CAPACITY` 转成 Refine `HttpError`。

JWT：`authProvider.login` → `POST /auth/login`；401 刷新；`check` → `GET /me`。

### 9.3 为什么用 Refine，以及明确不选什么

| 选项 | 结论 |
|------|------|
| **Refine + Vite** | **采用。** 登录、列表、权限、侧栏是现成的；账本/Fabric 用自定义页。 |
| **Refine + Next.js** | **不选。** 无 SSR 需求，VPS 不另跑 Node。 |
| 手写 Vite + shadcn | 被 Refine 取代样板代码；shadcn 仍作 UI 层。 |
| Ant Design Pro | 不选整套 Pro；shadcn 不够时可改 `@refinedev/antd`，provider 不动。 |
| react-admin | 不选；已定 Refine。 |

部署：`web/` 产出静态资源；`VITE_API_BASE=/api`。

远程 IDE、Web 终端仍是二期：code-server 在 Workspace 内；终端优先真 SSH。

---

## 10. 可观测与日志

MVP：

- `kubectl top` / metrics-server
- 节点：内存、磁盘、**EasyTier 在线/RTT/p2p|relay**
- `ha-api` 访问日志 + allocation 审计表
- Bastion：登录成功/失败、目标 workspace、时长

二期：Prometheus + Grafana（VPS）、Loki 可选。

---

## 11. 安全基线（选型相关）

- 所有密钥：平台 CA 签发短时用户证书（Teleport）或用户上传公钥绑定账号。
- Workspace 默认出站可上网；入站仅 Bastion。
- 禁止 Nest：Workspace 内默认无 Docker socket 挂载（可按套餐开关「嵌套容器」并额外计资源）。
- 镜像允许列表（可选）：只许拉企业 registry。

---

## 12. 安装与制品分发

用户入口不是 Ansible，而是 **`ha-setup`**（详见 [10](10-fast-installer.md)）：

| 层级 | 选型 |
|------|------|
| 引导 | POSIX sh + 静态 Go；**瘦包内含 easytier-core** |
| 制品 | payload：k3s airgap、incus、底镜像、ha-agent |
| 入网 | **先 EasyTier**，再从 `http://10.88.0.1:9090` 拉包 |
| 加节点 UX | `add-node --host` + 密码，或目标机 `.run` |
| 内部 | 冻结版 k3s `install.sh` + `SKIP_DOWNLOAD` |

Ansible / cloud-init 不当作用户可见安装方式。

---

## 13. 决策记录（ADR 摘要）

| ID | 决策 | 理由 |
|----|------|------|
| ADR-001 | k3s server 仅市电控制面（现 VPS） | 手机不稳定；x86 worker 不等于控制面 |
| ADR-002 | Workspace = Incus 系统容器为主 | 真机感 + 硬限制 + 手机与普通主机都可行 |
| ADR-003 | 独立资源账本，默认不超售 | 满足「占用不可再分」 |
| ADR-004 | Bastion 唯一用户 SSH 入口 | 统一 ACL/审计，隐藏拓扑 |
| ADR-005 | 先 API+CLI，再丰满控制台 | 降低 M1–M2 风险 |
| ADR-006 | 加节点用 ha-setup + Depot payload | 一包+密码；多架构快装 |
| ADR-007 | amd64/arm64 分池、镜像与节点 arch 一致 | 禁止默译混跑；x86 主机一等公民 |
| ADR-008 | EasyTier 为默认 Fabric | 随便放、不挑网 |
| ADR-009 | overlay 可降级，禁止单路径绑死 | 控制面走公网 443；心跳/SSH 有后备；网断不删 Workspace |
| ADR-010 | 前端 **Refine + Vite + shadcn** | 后台骨架用 Refine；账本 API 不迁就 Inferencer；不用 Next 版 Refine |

下一篇：[02-architecture.md](02-architecture.md)
