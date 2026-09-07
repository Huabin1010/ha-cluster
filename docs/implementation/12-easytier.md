# 12 · EasyTier 公共中枢（设备随便放、不挑网络）

> 上级：[00-index.md](00-index.md)  
> 安装：[10-fast-installer.md](10-fast-installer.md)  
> 节点：[11-node-profiles.md](11-node-profiles.md)

---

## 1. 要解决的问题

设备不会待在同一个交换机上：

| 现实 | 若没有公共中枢 |
|------|----------------|
| 手机在运营商 NAT / 4G / 家里 Wi-Fi 后 | 没有稳定 IP，别人连不进来 |
| x86 主机在公司网、宿舍、异地机房 | 各是各的局域网 |
| 公网 IP 会变、UPnP 没有、对称 NAT | 端口映射方案（NPS 逐条隧道）爆炸 |
| 有的网只放行 443/HTTP | 纯 UDP VPN 打洞失败 |

**产品要求：** 机器放到哪都能加入集群，**不挑网络**。管理员和平台组件只认一套**虚拟内网地址**，不认各家的 192.168/10.x/运营商大内网。

**拍板：用 EasyTier 作为所有分布式设备的公共中枢（cluster fabric）。**

NPS/npc 继续服务**已经在跑的宝塔/测试站域名**，**不再**承担集群节点互联、k3s、Depot、Bastion 后端。

---

## 2. 为什么是 EasyTier（而不是继续 NPS / 先上 Tailscale）

| 方案 | 与「随便放、不挑网」 | 运维 | 结论 |
|------|----------------------|------|------|
| **逐条 NPS TCP 隧道** | 每开一个端口、一端掉线全断；无节点互访 | 已有，适合「把某机:80 映出来」 | **遗留 HTTP 入口**，不当集群底盘 |
| WireGuard 纯手工 | 打洞弱，对称 NAT / 4G 经常要中继 | 轻 | 不单独做 |
| Tailscale / Headscale | 能力接近 | 账号体系、协调服、部分环境依赖对方基础设施 | 备选；我们要自建中枢 |
| ZeroTier | 类似 | 中心协调 | 备选 |
| **EasyTier** | P2P 打洞 + **自建中继**；TCP/UDP/WS/WSS；NAT/4G/公司网常见能通；amd64/arm64 静态二进制 | 单文件 `easytier-core`，适合塞进 payload | **P1 采用** |

EasyTier 关键能力（实施按此设计，版本随 payload 冻结）：

- 同一 `network_name` + `network_secret` 组成一张虚拟网。
- 有公网的节点当 **peer / relay**（我们的 VPS）。
- 能打洞则节点直连（延迟好）；不能则自动经中继（仍通）。
- 监听可同时开 **UDP、TCP、WSS**：UDP 被墙时走 TCP；只放行 HTTPS 类路径时走 WSS。
- 虚拟 IPv4、主机名；Linux 上 TUN 网卡（如 `easytier`）。
- 静态二进制，手机与 x86 同一套，体积适合放进瘦引导包。

---

## 3. 逻辑：一张虚拟网盖住所有节点

```
                    用户浏览器 / SSH
                           │ 公网 443 / Bastion
                           ▼
                 ┌─────────────────────┐
                 │ VPS（常电 + 公网）    │
                 │ OpenResty / Bastion  │
                 │ k3s / ha-api / Depot │
                 │ easytier-core        │
                 │ 虚 IP 10.88.0.1      │
                 │ 监听 UDP/TCP/WSS     │  ← 公共中枢（中继 + 目录）
                 └──────────┬──────────┘
                            │ EasyTier overlay  10.88.0.0/16
         ┌──────────────────┼──────────────────┬─────────────┐
         ▼                  ▼                  ▼             ▼
   10.88.0.10          10.88.0.11        10.88.0.20     10.88.0.30
   phone1 4G           ginkgo 家宽        vince Wi-Fi    异地 x86
   NAT                 NAT                NAT            公司网
```

用户**不**需要加入 EasyTier（除非管理员自己要调试）。租户只走 HTTPS 与 Bastion。

### 3.1 先回答：只依赖 EasyTier 会不会太脆？

**会，如果把所有东西都绑死在它上面。** 上一版「所有集群流量只走 10.88.0.0/16」这个写法过于绝对，现纠正。

脆弱点是真实的：

| 风险 | 若无降级会怎样 |
|------|----------------|
| EasyTier 进程/版本坑（相对 WG/Tailscale 更年轻） | 全员虚 IP 消失 |
| 中继只在一台 VPS 上 | 打洞失败的节点与 VPS 同命运 |
| 手机内核 TUN、4G 切换、对称 NAT | 隧道抖动 → kubelet NotReady → 误杀工作负载 |
| 密钥/实现被当成「内网已经安全」 | 一破全穿 |
| k3s `node-ip` 绑死虚 IP | overlay 一抖，编排面当节点死了 |

**正确模型：EasyTier 是「随便放」的优选底盘（preferred fabric），不是平台的生命体征。**

对照：Workspace 是本机 Incus 容器。网线（overlay）拔了，**机器还在跑、资源仍占用**；只是暂时 SSH/调度不到。这和云厂商「网络故障 ≠ 删盘」一样。

控制面给用户看的 HTTPS（OpenResty / ha-api / 登录）跑在 VPS 公网 **443**，**本来就不该经过 EasyTier**。overlay 挂了，管理员仍应能打开控制台，看到「节点 overlay 中断」，而不是整站 502。

### 3.2 三平面：谁必须独立、谁可以靠 overlay

```
[A 用户面]  浏览器 → VPS:443 / Bastion:22     禁止依赖 EasyTier
[B 管理面]  ha-agent 心跳、账本、装包          EasyTier 优先，公网 HTTPS 可降级
[C 数据面]  节点互访、Bastion→Workspace SSH    EasyTier 优先；同 LAN 直连；NPS 破窗
```

| 流量 | 主路径 | overlay 挂了 |
|------|--------|----------------|
| 控制台 / 登录 / 账本 API | VPS **公网 443** | **仍可用** |
| 用户 SSH 到 Bastion 进程 | VPS 公网 22/8099 | **仍能登上跳板**（后面进不了机） |
| ha-agent → ha-api 心跳 | `10.88.0.1` | 降级 `https://api.mnnumath.vip`（同一 ha-api） |
| Depot 拉包 | overlay 9090 | 降级 HTTPS Depot 或本机已缓存 payload |
| k3s agent → API | `10.88.0.1:6443` | 节点标 NotReady；**不删 Incus Workspace** |
| Bastion → Workspace | EasyTier 虚 IP | ① 同 LAN 直连 ② 已有 NPS SSH 口破窗 ③ 提示用户等待 overlay |
| 节点 ↔ 节点东西向 | EasyTier | 暂不可用（可接受） |

k3s 是平台自己的编排面，**不是**用户虚机的运行时。Incus 不因 kubelet NotReady 被销毁。grace period 要拉长（电池节点本就常掉线）。

### 3.3 底盘可替换（防「绑死一个项目」）

代码与文档里把这一层叫做 **Fabric**，EasyTier 是第一种实现：

```
Fabric 接口：Join / Status(ip, path, rtt) / Dial(node, port)
  ├── easytier   P1 默认
  ├── lan-direct 探测到 RFC1918 可达则并行使用（更快）
  ├── nps-breakglass  仅 SSH 紧急，不承载 k3s
  └── wireguard/tailscale  预留，不实现也要留配置位
```

`ha-agent` / Bastion **禁止**写死 `10.88.0.x` 为唯一 backend。节点记录里同时存：

- `fabric_ip`（EasyTier）
- `lan_ip`（若有）
- `breakglass_ssh`（可选 NPS 宿主端口，仅平台管理员 ACL）

拨号顺序：fabric → lan → breakglass。

### 3.4 中继不要单点

即使 overlay 仍用 EasyTier，中枢也可以不脆：

1. **双监听**：UDP + TCP + WSS（单机已抗一种封锁）。  
2. **第二中继** `10.88.0.2`：任意有公网的 x86，`--role et-relay`；worker `--peers` 写两个。P1 能上就上，不能则文档写清「单中继风险」。  
3. **已打洞的 P2P 不经 VPS**：VPS 短重启，直连节点可暂存。  
4. **官方公共节点默认关**（第三方中继更脆、有隐私问题）；仅当自家两个 peer 都死且管理员显式打开。

### 3.5 运行时保护（避免抖动误杀）

- `easytier-core` systemd `Restart=always`，先于 k3s。  
- kubelet `node-status-update-frequency` / controller `node-monitor-grace-period` 对 `power=battery` **加大**（分钟级），避免 4G 切网杀 Pod。  
- Orchestrator：overlay `down` ≠ `node_lost`（没电/SSH 全无才是 lost）。状态机增加 `fabric_degraded`。  
- 用户 SSH 失败时控制台文案：「环境仍在运行并占用配额；网络中枢暂时不可达」，禁止自动销毁。

---

## 4. 地址与命名规划

| 项 | 值 | 说明 |
|----|-----|------|
| Overlay CIDR | **`10.88.0.0/16`** | 避开常见家宽 192.168.1.0/24、部分云 10.0.0.0/8 冲突；若冲突可改 `--ipv4` 段 |
| 网卡名 | `easytier` | k3s `--flannel-iface=easytier` |
| 网络名 | **`ha-c1`**（已冻结，T2） | 非公开默认网；密钥见 `credentials.local.md` |
| 网络密钥 | 独立 `et_secret` | 与 k3s token 分开；进 join token |
| 冻结版本 | **easytier-core 2.6.4** | amd64/arm64 同 tag；二进制 `/usr/local/bin/easytier-core` |
| VPS | **`10.88.0.1/16`** 静态 | 控制面、默认 Depot、默认中继；`et-vps-1` |
| 预留 | `10.88.0.2–9` | 第二中继、备用 Depot |
| Worker（草案，实施归 T4） | `10.88.0.10` phone1 · `10.88.0.11` ginkgo · `10.88.0.20` vince | 写入账本，与 hostname 绑定 |
| 试连 | **`10.88.0.30`** = `dev-pc`（`et-dev-pc`，T2 已通） | 开发机；不必是最终 worker |
| 禁止 | 虚 IP 当公网广告 | 安全组不映射 TUN |

### 4.1 已分配虚 IP 表（T2 填实）

| 虚 IP | 节点 | instance_name | 状态 |
|-------|------|---------------|------|
| `10.88.0.1` | vps-1 | `et-vps-1` | 中枢 active |
| `10.88.0.2–9` | （预留） | — | 未分配 |
| `10.88.0.10` | phone1 | `et-phone1` | 草案，T4 |
| `10.88.0.11` | ginkgo | `et-ginkgo` | 草案，T4 |
| `10.88.0.20` | vince | `et-vince` | 草案，T4 |
| `10.88.0.30` | dev-pc | `et-dev-pc` | T2 试连已通（~25ms p2p tcp/wss） |

主机名建议：`et-<node_id>`，与 EasyTier `instance_name` 一致，便于 `ping et-phone1`。

节点一旦分配虚 IP，**尽量不再改**（k3s node-ip、证书 SAN 会绑它）。重装用同一 `--ipv4`。

---

## 5. VPS 中枢配置要点

VPS 是「公共中枢」：目录 + 打洞协助 + 打不通时的中继。

安全组**额外**放行（不要用 80/443，不要抢 8088–8097）：

| 端口 | 协议 | 用途 |
|------|------|------|
| **11010** | UDP | EasyTier 主监听（打洞/数据） |
| **11010** | TCP | UDP 不行时的回退 |
| **11011** | TCP/WSS | 更严防火墙 / 部分 4G 代理环境 |

示例角色（逻辑，非最终 CLI 冻结版）：

```text
# 中枢（VPS）— 生产由 systemd easytier.service + /etc/ha-cluster/easytier.env 拉起
easytier-core \
  --ipv4 10.88.0.1/16 \
  --network-name ha-c1 \
  --network-secret <et_secret> \
  --listeners udp://0.0.0.0:11010 tcp://0.0.0.0:11010 wss://0.0.0.0:11011 \
  --dev-name easytier \
  --instance-name et-vps-1
```

```text
# 任意 worker / 试连客户端（家宽 / 4G / 公司网 / 另一城市）
easytier-core \
  --ipv4 10.88.0.30/16 \
  --network-name ha-c1 \
  --network-secret <et_secret> \
  --peers tcp://server.mnnumath.vip:11010 \
  --peers wss://server.mnnumath.vip:11011 \
  --dev-name easytier \
  --instance-name et-dev-pc \
  --no-listener
```

`--peers` 只指向**我们的 VPS**（可写域名）。  
官方公共共享节点（`--external-node`）**保持关闭**。

systemd：仓库 [`deploy/easytier.service`](../../deploy/easytier.service) + [`deploy/easytier-start.sh`](../../deploy/easytier-start.sh)；`EnvironmentFile=/etc/ha-cluster/easytier.env`（**不要**写进 T1 的 `api.env`）。`Restart=always`；先于 k3s/ha-agent。

---

## 6. 与 k3s / Incus / Bastion 的衔接

### 6.1 k3s

- server / agent 均：`--node-ip=<easytier-ipv4>`。
- `--flannel-iface=easytier`。
- overlay 已提供节点三层互通时，优先 **flannel host-gw**（少一层 VXLAN）；EasyTier 未就绪则 k3s 不得启动（unit `After=easytier-core.service`，安装器做就绪探测）。
- API **只绑 10.88.0.1:6443**（或 0.0.0.0 但安全组不对公网放 6443）。
- kubeconfig 给管理员的集群地址：`https://10.88.0.1:6443`（管理员笔记本若要 kubectl，也加入同一 EasyTier，或走 Bastion/SSH 隧道）。租户默认不发集群 kubeconfig 到公网。

### 6.2 东西向（相对旧稿的变更）

旧稿 P1「不承诺跨手机 Pod 互通」，前提是没有公共底盘。

**有 EasyTier 之后：承诺「节点虚 IP 互通」（含不同 NAT 域）。**  
仍不承诺：

- 与公网 Internet 二层广播；
- Workspace 默认暴露到 overlay 全网（默认仍 NAT 在节点内，仅 Bastion/平台打入）；
- 带宽等同局域网（4G 中继会慢，调度应避开大镜像走差网节点，见 [11](11-node-profiles.md)）。

### 6.3 Incus Workspace

- 容器网桥默认 NAT 出节点，节点经 EasyTier 出网。
- SSH：Bastion **优先**拨 EasyTier；失败则试 `lan_ip`，再试登记过的 NPS 破窗口（仅平台策略允许时）。
- **不要**给每个 Workspace 默认在 NPS 上开公网映射；破窗是节点级一条 SSH，不是租户入口。

### 6.4 Depot

- 控制面 Depot：`http://10.88.0.1:9090`。
- 若某 x86 也在 overlay 里且磁盘大：可当第二 Depot（`10.88.0.2`），安装器选 RTT 更低者。
- 同家宽下两台机器 EasyTier 打洞成功后，可走 P2P，不一定绕 VPS。

---

## 7. 安装器：先入网，再装集群

「不挑网络」必须反映在 `ha-setup` 顺序里，否则异地机器拉不到 payload。

```
1. 瘦包到达目标机（U 盘 / 网盘 / 临时 scp，不依赖集群网）
2. 输入 root 密码 / sudo
3. 写入 network-name + secret + peers（来自 join token）
4. 安装并启动 easytier-core（二进制在瘦包内，amd64/arm64 各一份或按 arch 选）
5. 等待虚 IP 就绪（ping 10.88.0.1）
6. 从 Depot(10.88.0.1:9090) 拉完整 payload   ← 此时已不挑物理网
7. 装 k3s / incus / ha-agent（全部配置 EasyTier IP）
8. 上报节点：et_ip、path=p2p|relay、rtt
```

`add-node --host 192.168.x.x` 仍适用于**此刻能 SSH 到的地址**（同 LAN 或旧 NPS）。  
机器已经在天涯、只有 4G：用本地 `.run`，不要求管理端先 SSH 进去。

join token 增加 EasyTier 字段：

```
ha://join/<cluster>/<secret>
  ?et_net=ha-<id>
  &et_peer=tcp://server.mnnumath.vip:11010
  &et_peer2=wss://server.mnnumath.vip:11011
  &et_cidr=10.88.0.0/16
  &api=https://10.88.0.1:8443
  &api_public=https://api.mnnumath.vip
  &k3s=https://10.88.0.1:6443
  &depot=http://10.88.0.1:9090
  &depot_public=https://depot.mnnumath.vip
```

`api_public` / `depot_public` 给 overlay 未就绪或中断时用（TLS + 短时 token）。胖包 `.run` 可完全不靠 Depot。

`et_secret` 随 token 一次性下发，不写进公开 README。

---

## 8. 路径质量与调度

ha-agent 上报：

```
overlay: { ip, peer_path: p2p|relay, rtt_ms, tx_loss, ifname }
```

调度打分（叠加 [11](11-node-profiles.md)）：

- `relay` + 高 RTT：降权拉镜像、降权交互式 Workspace；
- `p2p` 且 mains：优先；
- overlay 断开：标 `fabric_degraded`，**不等于**没电；Incus 保持；禁止自动释放占用。

vince 亮屏 HUD 导致无线变慢时，EasyTier 仍「能通」但吞吐差 → 必须看 RTT/loss，不能只看「隧道 up」。

---

## 9. 安全

| 项 | 要求 |
|----|------|
| 网络密钥 | 高强度；可旋转（需滚动重启 easytier，选维护窗） |
| 谁能加入 | 仅持有 join token 的安装器；禁止把网络名/密钥发到聊天群长期挂着 |
| 公网暴露 | 仅 11010/11011；**关闭** 6443/9090/22-到-worker 的公网放行 |
| 租户隔离 | EasyTier 是**平台底盘**，不是租户 VPN；Workspace 默认进不了别的节点 |
| 中继流量 | 默认只经自家 VPS；第三方公共节点默认关 |
| 防火墙 | 节点防火墙：来源 `10.88.0.0/16` 才放行 k3s/agent/SSH-backend |

---

## 10. 与 NPS 的边界（必须写清）

| 用途 | 走哪 |
|------|------|
| 租户控制台 / 登录 | **公网 443**，不经 EasyTier |
| 节点互访、k3s、默认 Bastion 后端 | **EasyTier 优先** |
| ha-agent 心跳 / 公开 Depot | overlay 优先，**HTTPS 降级** |
| 已有 `*.phone.mnnumath.vip` 宝塔站 | **仍走 NPS + OpenResty** |
| overlay 挂了还要进某台机 | **NPS 809x 破窗**（节点级 SSH，不是租户入口） |
| 新端口 | EasyTier 11010/11011；不占用 8088–8097 |

长期可将站点也迁到「OpenResty → 10.88.0.x:80」，从而少依赖 npc 在线；不作为安装器 P1 阻塞。

---

## 11. 高可用

| 故障 | 影响 | 缓解 |
|------|------|------|
| 两节点已 P2P | VPS 短重启，直连可暂存 | 新加入仍要中枢 |
| VPS EasyTier 挂 | 中继节点 overlay 断 | 控制台仍开；心跳走 HTTPS；Workspace 不删；systemd + 第二中继 |
| 仅 UDP 被墙 | 自动 TCP/WSS | 中枢多监听 |
| overlay 全断 | SSH 进不了 Workspace | Bastion 提示 degraded；破窗 NPS；配额保持 |
| 整机没电 | 才是 node_lost | 与 overlay 故障分开处理 |

第二中继：`ha-setup --role et-relay`，虚 IP `10.88.0.2`，worker `--peers` 写两个（P1 能上就上）。

---

## 12. 验收（「不挑网络」）

1. VPS + 家宽手机 + 4G 手机 + 另一网段 x86 均拿到 `10.88.0.0/16` 地址，`ping 10.88.0.1` 通。  
2. **关闭** 安全组 6443 公网后，k3s agent 仍 Ready。  
3. 不新增任何 NPS 隧道，Bastion 能 SSH 进 Workspace。  
4. 模拟 UDP 阻断后，节点经 TCP 或 WSS 仍在线（允许降级为 relay）。  
5. 安装器在「管理端与目标不在同一 LAN」时，用 `.run` 仍能 join（先 ET，再拉 payload）。  
6. 故意填错 `network_secret` 无法入网。  
8. **停掉 easytier-core**：控制台仍可登录；节点显示 `fabric_degraded`；Incus Workspace 进程仍在；配额不释放。  
9. ha-agent 在 overlay 断开后仍能通过公网 HTTPS 上报心跳（允许延迟变高）。

下一篇回到：[09-roadmap.md](09-roadmap.md) · 总览：[00-index.md](00-index.md)
