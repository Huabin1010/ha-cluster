# 13 · 剩余工作：五件互不重叠的独立任务

> 上级：[00-index.md](00-index.md)  
> 设备：[inventory.md](../inventory.md)  
> 更新：2026-09-06  
> 原则：**按机器 + 端口 + 目录切开。** 两人不要改同一个文件、同一端口、同一 systemd 单元。联调有先后，工作内容不交叉。

仓库里控制面代码已经能在笔记本跑。下面五项是**上线前在真机器上要做完的事**，做完用户才能：打开网页登录 → 申请一台隔离环境 → SSH 进去。

---

## 总表

| ID | 一句话 | 主战场 | 独占端口 | 独占目录 / 单元 | 大约耗时 |
|----|--------|--------|----------|-----------------|----------|
| **T1** | 公网能打开控制台，数据在 Postgres | `vps-1` 的 **80/443** 与本机 5432/**18082** | 80, 443, 127.0.0.1:5432, 127.0.0.1:18082 | `/etc/ha-cluster/api.env`、`/var/www/ha-web`、`ha-api.service`、OpenResty 站点 | 0.5–1 天（**已完成**） |
| **T2** | 两台机器能 `ping 10.88.0.1` | `vps-1` 安全组 **11010/11011** + 一台试连机 | UDP/TCP 11010、TCP 11011 | `/etc/ha-cluster/easytier.env`、`easytier.service` | 0.5 天 |
| **T3** | 打出 amd64/arm64 离线包并本机提供下载 | **开发机** | **仅本机** 9090（禁止对公网、禁止进 OpenResty） | `packaging/`、`dist/` | 1 天 |
| **T4** | 一台 worker 心跳进 API，并能真起 Incus | 先 **一台** worker；k3s server 可装在 VPS 但只绑虚 IP | 6443 **仅 10.88.0.1** | 该 worker 的 incus、`ha-agent.service`、`/var/lib/ha-setup/`；VPS 上仅 `k3s` 相关 | 1–2 天 |
| **T5** | 用户 SSH 进 Workspace 而不是 VPS root | `vps-1` 的 **22 或 8099** | 22 或 8099（不抢 8088–8097） | sshd drop-in、`ha-bastion-proxy`、`ha-auth-keys` | 0.5–1 天 |

```
可同时开工：T1 ∥ T2 ∥ T3
必须等别人成品：T4 读 T3 的包、连 T2 的网、调 T1 的 API
                 T5 用 T1 的 token、连 T4 已经 RUNNING 的容器
```

**禁区（五项共通）：** 不占用 NPS 8088–8097；不把 80/443 交给 NPS/EasyTier；密码只进 `docs/credentials.local.md`。

**不要塞进这五项：** Teleport、Web IDE、OIDC、双机热备、KubeVirt、三台手机全加完、宝塔站迁网。

---

## 文件所有权（防重叠）

| 路径 | 谁可以改 |
|------|----------|
| `web/` 构建产物、OpenResty 站点配置、`deploy/ha-api.service`、`deploy/openresty-ha.conf` | **仅 T1** |
| `deploy/easytier.service`、inventory 里 EasyTier 段落、`12-easytier.md` 地址表 | **仅 T2** |
| `packaging/`、`dist/`、`packaging/pack.sh` | **仅 T3** |
| worker 上 `/var/lib/ha-setup/`、该机 incus、VPS 上 k3s 安装（不含 OpenResty） | **仅 T4** |
| `deploy/sshd-bastion.conf`、`deploy/ha-auth-keys.sh`（若新建）、sshd 配置 | **仅 T5** |
| `docs/inventory.md` | 各任务 **只追加自己那一小节**，不要重写别人已填的表 |
| `docs/credentials.local.md` | 各任务只追加自己的密钥块（T1 JWT、T2 ET secret、T5 bastion token） |

---

# T1 · 公网控制面

## 目标

浏览器打开 `https://ha.mnnumath.vip`（或本任务选定的主机名）能登录；`/api` 同源反代到本机 `ha-api`；Postgres 持久化；**重启 API 项目还在**。

本任务结束时：**不能** SSH 进虚机，**不要求** 手机在线。

## 机器

只登录 `vps-1`：`ssh root@server.mnnumath.vip`（`106.52.109.127`）。开发机只负责 `npm run build` 和 `go build`。

## 逐步命令

**1) 摸清 VPS（写进 inventory「vps-1」表）**

```bash
hostnamectl; lscpu | egrep 'Model name|^CPU\(s\)'; free -h; df -h /
ss -lntp | egrep ':22|:80|:443|:8080|:5432' || true
```

记下 `:22` 是否已被管理 SSH 占用（供 T5 决定用 22 还是 8099，**T1 只记录，不改 sshd**）。

**2) Postgres（只绑 127.0.0.1）**

```bash
apt-get update
apt-get install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE USER ha WITH PASSWORD '改成强密码';"
sudo -u postgres psql -c "CREATE DATABASE ha OWNER ha;"
# postgresql.conf: listen_addresses = 'localhost'
# pg_hba.conf: 仅 local/127.0.0.1 scram
systemctl restart postgresql
```

连接串（写入 `/etc/ha-cluster/api.env`，**不进 Git**）：

```
DATABASE_URL=postgres://ha:密码@127.0.0.1:5432/ha?sslmode=disable
```

**3) 编译安装 ha-api**

在开发机（Go 1.24+）：

```bash
export PATH="$HOME/.local/go/bin:$PATH"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ha-api ./cmd/ha-api
scp ha-api root@server.mnnumath.vip:/usr/local/bin/ha-api
```

**4) 环境与 systemd**

```bash
mkdir -p /etc/ha-cluster
cat >/etc/ha-cluster/api.env <<'EOF'
DATABASE_URL=postgres://ha:密码@127.0.0.1:5432/ha?sslmode=disable
HA_JWT_SECRET=用openssl_rand_hex_32生成
HA_ADMIN_PASSWORD=首次登录后立刻改
HA_API_ADDR=127.0.0.1:18082
HA_RUNTIME=memory
HA_INTERNAL_TOKEN=给T5预留的随机串
HA_SEED=1
EOF
# 注：VPS 上 :8080 已被 DataEase 占用，生产用 18082；OpenResty 反代到该口
chmod 600 /etc/ha-cluster/api.env
cp /path/to/repo/deploy/ha-api.service /etc/systemd/system/ha-api.service
# 确认 Unit 里 EnvironmentFile=-/etc/ha-cluster/api.env
systemctl daemon-reload
systemctl enable --now ha-api
curl -fsS http://127.0.0.1:18082/healthz
```

**5) 前端静态资源**

```bash
cd web && npm ci && npm run build
rsync -a --delete dist/ root@server.mnnumath.vip:/var/www/ha-web/
```

**6) OpenResty（1Panel 已占 80/443，只加站点，不换进程）**

建议主机：`ha.mnnumath.vip` → `106.52.109.127`（若用别的名字，写进 inventory 后全文以那名为准）。

配置思路（仓库样例 `deploy/openresty-ha.conf`）：

- `root /var/www/ha-web;` `try_files $uri /index.html;`
- `location /api/ { proxy_pass http://127.0.0.1:8080/; ... }`
- 证书用现有 Let’s Encrypt，**不要**再起一个抢 80 的 certbot 独立服务

重载 OpenResty。安全组：**不要**新开放 8080、5432。

## 验收（全过才算完）

```bash
systemctl is-active ha-api
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS https://ha.mnnumath.vip/api/healthz
# 浏览器登录 admin / HA_ADMIN_PASSWORD，创建一个项目
systemctl restart ha-api
# 再打开控制台，项目还在
ss -lntp | grep 8080   # 应为 127.0.0.1:8080，不是 0.0.0.0
```

## 交付

- inventory：VPS CPU/内存/磁盘、`:22` 占用、控制台 URL  
- `credentials.local.md`：`HA_JWT_SECRET`、`HA_INTERNAL_TOKEN`、DB 密码（T5 会读 INTERNAL_TOKEN，只读不改）

## 禁止

改安全组 11010、装 easytier/k3s/incus、改 sshd、打 `dist/` 包。

---

# T2 · EasyTier 虚网

## 目标

VPS 上 `10.88.0.1` 常驻；开发机（或任意一台 Linux）加入后 `ping 10.88.0.1` 通。不管控制台、不管容器。

## 机器

- 必做：`vps-1`  
- 试连：优先 `dev-pc`（`huanghuabin-MS-7E61`），不必用手机

## 逐步命令

**1) 安全组（控制台操作，只加这三条）**

| 端口 | 协议 | 来源 |
|------|------|------|
| 11010 | UDP | 0.0.0.0/0 |
| 11010 | TCP | 0.0.0.0/0 |
| 11011 | TCP | 0.0.0.0/0 |

不要顺手打开 6443、9090、8080。

**2) VPS 安装中枢**

冻结一个 EasyTier 版本（例如从 GitHub Releases 下 `easytier-linux-x86_64`），记下版本号到 inventory。

```bash
install -m 0755 easytier-core /usr/local/bin/easytier-core
cat >/etc/ha-cluster/easytier.env <<'EOF'
HA_ET_NET=ha-prod
HA_ET_SECRET=高强度随机
EOF
chmod 600 /etc/ha-cluster/easytier.env
```

启动示例（按你下载的 CLI 微调，以 `--help` 为准；网络名/密钥与 env 一致）：

```bash
# 虚 IP 必须 10.88.0.1
easytier-core \
  --ipv4 10.88.0.1 \
  --network-name ha-prod \
  --network-secret '<密钥>' \
  --listeners udp://0.0.0.0:11010 tcp://0.0.0.0:11010 wss://0.0.0.0:11011
```

systemd 用 `deploy/easytier.service`，**EnvironmentFile 必须是 `easytier.env`，禁止改 T1 的 `api.env`**。

```bash
systemctl enable --now easytier
ip -4 addr show | grep 10.88.0.1
ss -ulnp | grep 11010
ss -tlnp | grep -E '11010|11011'
```

官方公共共享节点：**关**。

**3) 客户端（开发机）**

同一版本二进制，虚 IP 建议 `10.88.0.30`（T4 给 worker 编号时从 `.10` 起，避开 `.30`）。

```bash
easytier-core \
  --ipv4 10.88.0.30 \
  --network-name ha-prod \
  --network-secret '<同一密钥>' \
  --peers tcp://server.mnnumath.vip:11010 \
  --peers wss://server.mnnumath.vip:11011
ping -c 3 10.88.0.1
```

**4) 回退抽检：** 安全组临时去掉 UDP 11010，客户端应仍能经 TCP/WSS 维持（可 relay）。测完加回 UDP。

## 验收

- VPS 有 `10.88.0.1`  
- 客户端 `ping 10.88.0.1` 通  
- `ss` 显示 80/443 仍是 OpenResty，不是 easytier  
- 密钥只在 `credentials.local.md` 的「EasyTier」小节

## 禁止

`apt install k3s`、改 OpenResty、`incus launch`、制作 tar、改 sshd、给三台手机批量分配 IP（只允许试连机一个 IP）。

---

# T3 · 离线 payload 与 Depot

## 目标

开发机上两份目录可下载、可校验；**不登录手机、不起容器**。

```
dist/payload-linux-amd64/
dist/payload-linux-arm64/
```

## 机器

只在 `dev-pc`。Depot 监听 `127.0.0.1:9090`。若要给 T4 用，等 T2 通了再在 overlay 上绑 `10.88.0.30:9090` 或 `10.88.0.1:9090`，**仍然不要进 80/443**。

## 逐步命令

**1) 冻结版本，写入 `dist/VERSIONS.md`（本任务独占）**

至少列出：k3s 版本、airgap 镜像文件名、easytier-core 版本、Ubuntu Incus 镜像标签、ha-agent 构建 commit。

**2) 下载上游制品（示例，版本以 VERSIONS 为准）**

```bash
# k3s 官方 binary + k3s-airgap-images-amd64.tar.zst / arm64
# easytier 对应 arch
# incus 镜像：在已装 incus 的开发机
incus image copy images:ubuntu/24.04 local: --alias ubuntu-2404
incus image export ubuntu-2404 ./ubuntu-24.04
```

**3) 扩写并运行打包脚本（只改 `packaging/`）**

现有 `packaging/pack.sh` 目前只编 `ha-agent`/`ha-setup`。本任务必须改成：

- 参数：`amd64` 或 `arm64`  
- 把 k3s、airgap、easytier-core、镜像、deb 拷进对应 `dist/payload-linux-<arch>/`  
- 生成 `manifest.json`（含 `"arch"` 字段）和 `SHA256SUMS`  
- **缺文件则非 0 退出并打印缺什么**，禁止打空包

```bash
bash packaging/pack.sh amd64
bash packaging/pack.sh arm64
sha256sum -c dist/payload-linux-amd64/SHA256SUMS
```

体积：arm64 尽量 ≤ 800MiB（zstd）；超了在 VERSIONS 写原因。

**4) Depot**

```bash
cd dist && python3 -m http.server 9090 --bind 127.0.0.1
curl -fsS http://127.0.0.1:9090/payload-linux-amd64/manifest.json
```

不要把这个 location 加进 OpenResty。

## 验收

- 两个 arch 脚本退出 0，manifest 的 `arch` 与目录名一致  
- 抽查一个大文件 sha256 匹配  
- `curl` 本机 9090 成功  
- Git 可不提交 `dist/` 大文件，但 VERSIONS 写清「包在哪台机器哪条路径」

## 禁止

`ssh` 进手机安装、改安全组、改 `web/` 业务页、改 sshd、改 `api.env`。

## 附录 · Depot 与重建（已完成）

```bash
bash packaging/fetch-deps.sh all
bash packaging/pack.sh amd64
bash packaging/pack.sh arm64
bash packaging/depot.sh   # http://127.0.0.1:9090/
```

冻结版本与本机路径见 `dist/VERSIONS.md`；操作说明见 [`packaging/README.md`](../../packaging/README.md)。

---

# T4 · 一台 Worker 运行时

## 目标

**一台**机器成为 worker：心跳出现在 T1 的节点列表；并能真正 `incus` 起一个 `nano` Workspace（推荐验收路径 A，见下）。

## 机器

- Worker 候选（只选 **一台** 做完即过关）：`dev-pc`（省事，amd64）或 `vince`/`phone1`（arm64，更接近生产）。  
- VPS：本任务 **只允许** 安装 k3s **server**（绑 `10.88.0.1:6443`），**禁止**改 OpenResty、禁止改 `ha-api` 监听与证书。

## 必须先有的输入（只读）

| 来自 | 输入 |
|------|------|
| T3 | `dist/payload-linux-<本机arch>/` 整包 |
| T2 | 网络名、密钥、`--peers`、本 worker 的虚 IP（手机从 `10.88.0.10` 起编，避开 T2 试连用的 `.30`） |
| T1 | `https://ha.mnnumath.vip/api` 可登录（客户端身份） |

T2 未完成时：允许 LAN 临时联调，**禁止自建另一套 EasyTier 网络名**。

## 验收路径（必须书面勾选一个）

当前 `ha-api` 的 Incus 运行时是 **本机 exec `incus`**，因此：

- **A（推荐）：** 开发机同时跑 Incus；把该机 `HA_RUNTIME=incus` 的 `ha-api` 用于验证创建 Workspace（可以是开发机本地 API，也可以把 worker 与 API 暂放同机）。控制台里点创建后 `incus list` 出现 `ha-*` RUNNING。  
- **B：** worker 只保证 `ha-agent` 心跳 + 手工 `incus launch`；远端 API 调 Incus 不算本任务完成。

**默认按 A 验收。** 选 B 必须在完成记录写明。

## 逐步命令（worker）

```bash
# 1) 只读拷贝 T3 包，不要现场 curl 官方 k3s 安装脚本下载
scp -r dist/payload-linux-arm64 root@<worker>:/var/cache/ha-payload

# 2) join 文件（token 由 T1/T2 拼好，含 et_net / et_peer / api）
./ha-setup join --token 'ha://join/prod/<secret>?et_net=ha-prod&et_peer=tcp://server.mnnumath.vip:11010&api=https://10.88.0.1:8080' \
  --role worker --root /var/lib/ha-setup

# 3) 按 payload 安装 incus、导入镜像、k3s-agent（SKIP_DOWNLOAD）
#    K3S_URL=https://10.88.0.1:6443
# 4) systemd ha-agent
install -m 0755 ha-agent /usr/local/bin/ha-agent
cp deploy/ha-agent.service /etc/systemd/system/
systemctl enable --now ha-agent
```

VPS 上 k3s server（属于 T4，不是 T1）：

```bash
# 使用 payload 内 k3s 二进制，不要网上最新版
# --node-ip=10.88.0.1 --flannel-iface=<easytier网卡名>
# 安全组不对公网放 6443
```

控制面污点：不把用户 Workspace 调到 VPS。

心跳验收：

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" https://ha.mnnumath.vip/api/nodes
# 应含 name=该机, ready=true, arch=amd64|arm64
```

创建 `nano`（路径 A）：控制台或 API `POST /projects/{id}/workspaces` `{"plan":"nano","arch":"<与节点一致>"}` 后：

```bash
incus list | grep ha-
```

超售：同一节点可售内存不够再下一份 `large` 时必须 **HTTP 409** `INSUFFICIENT_CAPACITY`。

> **硬缺口修复注记（见 [21-core-pipeline-spec.md](21-core-pipeline-spec.md)）：**
> - **真实磁盘探测**：`ha-agent` 必须调用 `unix.Statfs` 动态获取挂载点实际剩余磁盘，禁止默认写死 40 GiB。
> - **跨机远程编排**：当控制面 VPS 与 Worker 不在同机时，`ha-agent` 必须在 EasyTier 虚 IP 监听 `:9091`（`X-HA-Node-Token` 鉴权），供控制面远程下发 Launch / Stop / Destroy / Sync-Keys。

## 验收表

| # | 标准 |
|---|------|
| 1 | `GET /api/nodes` 有该节点且 Ready |
| 2 | 节点可售磁盘来自 `Statfs` 真实探测，非写死 40G |
| 3 | 路径 A：`incus list` 有 RUNNING 的 `ha-*`（同机直接 exec 或跨机通过 agent:9091 编排） |
| 4 | 409 超卖可复现 |
| 5 | 6443 不对公网 |

## 交付

- 可复制的 join 命令（含虚 IP）  
- inventory 该节点：fabric IP、`nproc`、可售内存  
- 勾选 A 或 B

## 禁止

改 OpenResty、重打包 `packaging/`、配 Bastion sshd、把第二台手机也加进「必须完成」。

---

# T5 · 用户跳板 SSH

## 目标

```bash
ssh <平台用户名>@bastion.mnnumath.vip -p <22或8099> -t <workspace-uuid>
```

进去后是 **Workspace 里的 Linux**，不是 VPS 的 `VM-8-3-ubuntu`。

## 机器

只改 `vps-1` 的 **sshd** 与两个二进制。用 T1 的 API、T4 已 RUNNING 的实例、T2 的虚 IP。

## 输入（只读）

| 来自 | 输入 |
|------|------|
| T1 | `HA_INTERNAL_TOKEN`、`https://ha.…/api`、admin 能登录 |
| T4 | 一个 `status=running` 的 Workspace id、节点 `fabric_ip` |
| T2 | 从 VPS 能连到 `fabric_ip:22`（容器 SSH） |

## 逐步命令

**1) 端口**

若 `ss -lntp | grep ':22'` 已是管理 SSH：Bastion 用 **8099**，安全组放行 8099（不要动 8088–8097）。  
DNS：`bastion.mnnumath.vip` → `106.52.109.127`。

**2) 安装代理**

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ha-bastion-proxy ./cmd/ha-bastion-proxy
scp ha-bastion-proxy root@server.mnnumath.vip:/usr/local/bin/
```

环境（**新文件** `/etc/ha-cluster/bastion.env`，不要往 `api.env` 里堆）：

```
HA_API=http://127.0.0.1:8080
HA_TOKEN=<T1 上为跳板建的服务账号 JWT 或 PAT>
```

**3) `ha-auth-keys`**

若仓库还没有可执行脚本，本任务 **只允许新增** `deploy/ha-auth-keys.sh`：

```bash
# 读取 HA_INTERNAL_TOKEN，GET $HA_API/internal/authorized-keys?user=$1
# 把公钥打印到 stdout 给 sshd
```

**4) sshd drop-in**（参考 `deploy/sshd-bastion.conf`）

要点：`ForceCommand /usr/local/bin/ha-bastion-proxy`、`PermitTTY yes`、用户无法获得 VPS bash。  
`sshd -t && systemctl reload sshd`。

**5) 用户侧**

在控制台上传公钥（T1 已有 `/me/ssh-keys`），下载 SSH config，核对 Host/Port 与本任务端口一致。不一致时 **只改下载文案里的常量或文档**，不重构 Refine 页面。

**6) 正反用例**

- developer + running 共享机 → 进入后 `hostname` 不是 VPS  
- viewer → 拒绝  
- 随机 uuid → 拒绝  
- `GET /api/audit-logs`（admin）看得到会话尝试

## 验收表

| # | 标准 |
|---|------|
| 1 | SSH 进去不是 VPS 主机名 |
| 2 | ForceCommand 或原生 SSH Server 下不能在 VPS 执行 `id` 看到 root 宿主机随意 shell（应被代理或拒绝） |
| 3 | 无权限/错误 id 失败 |
| 4 | overlay 挂了不得掉进 VPS shell |
| 5 | 符合 [21-core-pipeline-spec.md](21-core-pipeline-spec.md) §4：支持空闲 30 分钟超时与会话审计写入 |

## 禁止

装 EasyTier、`incus launch`、打 payload、改 `/var/www/ha-web`、上 Teleport。

---

## 单人 / 多人怎么排

| 人力 | 顺序 |
|------|------|
| 一人 | T1 → T3 → T2 → T4 → T5 |
| 三人 | 周 1：T1∥T2∥T3；周 2：T4 然后 T5 |

---

## 勾选

| 任务 | 负责人 | 开始 | 完成 | 验收人 | 备注（T4 填 A/B） |
|------|--------|------|------|--------|-------------------|
| T1 公网控制面 | Cursor agent | 2026-09-06 | 2026-09-06 | 本机 curl/登录/重启持久化 1–6 已过 | https://ha.mnnumath.vip ；API `127.0.0.1:18082` |
| T2 EasyTier 虚网 | Cursor agent | 2026-09-06 | 2026-09-06 | ping 10.88.0.1 通；UDP 封后仍 tcp/wss；80/443 仍 OpenResty | `ha-c1` · v2.6.4 · 试连 `10.88.0.30` |
| T3 payload / Depot | Cursor agent | 2026-09-06 | 2026-09-06 | pack amd64/arm64 退出 0；sha 抽查；curl :9090 manifest OK | arm64 zst **452MiB**；`packaging/README.md` + `dist/VERSIONS.md` |
| T4 Worker 运行时 | Cursor agent | 2026-09-06 | 2026-09-06 | Path A + **worker-bundle 一键包** amd64/arm64 | **A** · `deploy/t4/` · `dist/ha-worker-bundle-linux-*.tar.zst` |
| T5 Bastion SSH | | | 2026-09-06 | | 端口 **8099**；`ha-bastion-sshd` active |

产品侧还有 **UI 五组（U1–U5）+ 功能测试五组（Q1–Q5）**，与上表正交、可并行：见 [14-ui-and-qa-tasks.md](14-ui-and-qa-tasks.md)。U1–U5 控制台页面已在 `web/` 落地；Q 组按 `docs/qa/Qx-*.md` 勾选用例即可。
