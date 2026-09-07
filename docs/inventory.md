# 设备台账

> 更新：2026-09-06  
> 密码 / NPS vkey / 宝塔口令见 [credentials.local.md](credentials.local.md)（gitignore）。模板：[credentials.example.md](credentials.example.md)  
> 域名：**`mnnumath.vip`**（中间有 u）

这些机器是 ha-cluster 的**物理库存**。它们不在同一机房、不能二层互通。集群互联走 **EasyTier 虚网**；用户 HTTPS 入口仍经腾讯云 VPS。NPS 仅遗留站点。

---

## 总览

| ID | 名称 | 代号 | SoC | 架构 | 角色（规划） | 公网入口 |
|----|------|------|-----|------|--------------|----------|
| `vps-1` | 腾讯云 | — | 云主机 | amd64 | **k3s server**、**EasyTier 中枢**、证书、NPS（遗留）、OpenResty | `106.52.109.127` |
| `phone1` | 小米 5 | gemini | MSM8996 / 骁龙 820 | aarch64 | k3s agent | `*.phone1.mnnumath.vip` |
| `ginkgo` | Redmi Note 8 | ginkgo | SM6125 / 骁龙 665 | aarch64 | k3s agent | `*.phone.mnnumath.vip` |
| `vince` | Redmi Note 5 / 5 Plus | vince | MSM8953 / 骁龙 625 | aarch64 | k3s agent | `*.phone2.mnnumath.vip` |
| `dev-pc` | 开发机 | — | 桌面 | amd64 | kubectl / 构建，默认不当 worker | 局域网 |

NPS：`server.mnnumath.vip:8088` 为 npc 连入。**不要**把 VPS 80/443 交给 NPS。

---

## vps-1 · 腾讯云

| 项 | 值 |
|----|-----|
| 主机名 | `VM-8-3-ubuntu` |
| 系统 | Ubuntu 22.04（内核 `5.15.0-94-generic`） |
| 公网 IP | `106.52.109.127` |
| SSH（管理） | `ssh root@server.mnnumath.vip`（**:22 已被 sshd 占用**；Bastion 勿抢 22，留给 T5 用 8099） |
| Web | 1Panel + OpenResty（占 80/443） |
| 穿透 | NPS，Web 仅本机 `http://127.0.0.1:18080` |
| 安全组（约） | 放行 22、80、443、8088、8089；**UDP/TCP 11010、TCP 11011（EasyTier）**；**TCP 8099（Bastion）**；8092/8095 等 SSH 隧道默认不对公网；**不对公网**放 6443/9090/5432/8080 |
| CPU | **2** × Intel Xeon Platinum 8255C @ 2.50GHz（amd64） |
| 内存 | **1.9 GiB**（实测；可用常 &lt;600 Mi，控制面偏紧） |
| 磁盘 | `/dev/vda2` **50G**（约用 56%） |
| 规划 | k3s **server**、**EasyTier 中枢**、证书、NPS（遗留站）、OpenResty；不跑 arm64 业务 Pod；可售容量按 **0** |
| Bastion SSH | **`bastion.mnnumath.vip:8099`**（独立 `ha-bastion-sshd`；管理 SSH 仍为 `:22`） |
| Bastion 配置 | `/etc/ssh/sshd_config_bastion` · `/etc/ha-cluster/bastion.env` · unit `ha-bastion-sshd` |
| EasyTier | **中枢** `10.88.0.1/16`；`easytier-core` **2.6.4**；unit `easytier.service`；env `/etc/ha-cluster/easytier.env`；监听 UDP/TCP **11010**、WSS **11011** |

OpenResty 按主机后缀分流：ginkgo `*.phone.` · phone1 `*.phone1.` · vince `*.phone2.`。

### T2 EasyTier 虚网（已部署 2026-09-06）

| 项 | 值 |
|----|-----|
| 网络名 | `ha-c1`（密钥见 credentials.local.md） |
| Overlay | `10.88.0.0/16`，网卡名 `easytier` |
| 中枢 | `vps-1` = `10.88.0.1`（`et-vps-1`） |
| 试连客户端 | `dev-pc` = `10.88.0.30`（`et-dev-pc`） |
| peers | `tcp://server.mnnumath.vip:11010` + `wss://server.mnnumath.vip:11011` |
| 旧 Docker `easytier` | 已 `docker stop` + `--restart=no`（曾占 11010/11011 的公共弱密钥网） |

可复制客户端启动（与 systemd 等价；密钥见凭据）：

```bash
# 开发机已装 /usr/local/bin/easytier-core 2.6.4 时：
sudo systemctl enable --now easytier
# 或一次性：
easytier-core \
  --ipv4 10.88.0.30/16 \
  --network-name ha-c1 \
  --network-secret '<见 credentials.local.md>' \
  --peers tcp://server.mnnumath.vip:11010 \
  --peers wss://server.mnnumath.vip:11011 \
  --dev-name easytier \
  --instance-name et-dev-pc \
  --no-listener
# 验收：ping -c 3 10.88.0.1
```

> 本机若开 Mihomo TUN：给 `106.52.109.127/32` 做 `route-exclude-address`（或 `PROCESS-NAME,easytier-core,DIRECT`），否则握手会假成功/超时。fake-ip 环境下可把 `server.mnnumath.vip` 钉到 `/etc/hosts` → `106.52.109.127`。

### T5 Bastion SSH（已部署 2026-09-06）

| 项 | 值 |
|----|-----|
| DNS | `bastion.mnnumath.vip` → `106.52.109.127` |
| 端口 | **8099**（勿用 22；勿抢 8088–8097） |
| sshd | `/etc/ssh/sshd_config_bastion` + systemd `ha-bastion-sshd` |
| 代理 | `/usr/local/bin/ha-bastion-proxy`（`ForceCommand`） |
| 公钥查询 | `/usr/local/bin/ha-auth-keys` → `GET /internal/authorized-keys` |
| 环境 | `/etc/ha-cluster/bastion.env`（`HA_API=http://127.0.0.1:18082`） |

用户侧 `~/.ssh/config` 样例（与控制台下载一致）：

```sshconfig
Host ha-<workspace-id前8位>
  HostName bastion.mnnumath.vip
  User <平台用户名>
  Port 8099
  ForwardAgent yes
  RequestTTY force
  RemoteCommand <workspace-uuid>
```

```bash
ssh <平台用户名>@bastion.mnnumath.vip -p 8099 -t <workspace-uuid>
```

平台用户须在 VPS 有对应 Linux 账号：`useradd -m -s /bin/bash <username>`（`ForceCommand` 覆盖 shell，无法落 VPS bash）。

### T1 公网控制面（已上线 2026-09-06）

| 项 | 值 |
|----|-----|
| 控制台 | **https://ha.mnnumath.vip/** |
| API | 同源 **https://ha.mnnumath.vip/api/** → `127.0.0.1:18082` |
| OpenResty 配置 | `/opt/1panel/apps/openresty/openresty/conf/conf.d/ha.mnnumath.vip.conf` |
| 静态根（容器内） | `/www/ha-web`（宿主机同卷：`…/openresty/www/ha-web`；另有副本 `/var/www/ha-web`） |
| TLS | Let’s Encrypt `ha.mnnumath.vip`，站点 ssl 目录 `/www/sites/ha.mnnumath.vip/ssl/` |
| `ha-api` | systemd `ha-api`；二进制 `/usr/local/bin/ha-api`；env `/etc/ha-cluster/api.env` |
| 监听 | **`127.0.0.1:18082`**（**:8080 已被 DataEase 占用**，故未用任务草稿中的 8080） |
| 数据库 | Docker `ha-postgres`（`postgres:16-alpine`），**仅** `127.0.0.1:5432`，库名 `ha` |
| 运行时 | `HA_RUNTIME=memory`（真 Incus 属 T4） |
| 登录 | 种子用户 `admin`；密码见 `credentials.local.md` |

### NPS 隧道占用（新服务不要抢）

| 用途 | VPS 口 | 目标 |
|------|--------|------|
| npc bridge | **8088** | — |
| ginkgo SSH | 8089 | `:22` |
| ginkgo HTTP | 8090 | `:80` |
| ginkgo 宝塔 | 8091 | `:33144` |
| phone1 SSH | 8092 | `:22` |
| phone1 HTTP | 8093 | `:80` |
| phone1 宝塔 | 8094 | `:24396` |
| vince SSH | 8095 | `:22` |
| vince HTTP | 8096 | `:80` |
| vince 宝塔 | 8097 | 面板端口（宝塔未装完） |

k3s API 建议 **8098** 或独立 `6443`，不要复用上表。

---

## phone1 · 小米 5（gemini）

| 项 | 值 |
|----|-----|
| 主机名 | `XiaoMi5-Ubuntu` |
| SoC | Qualcomm MSM8996（骁龙 820），aarch64 |
| 内存 | 约 **2.6 GiB**（装宝塔时已偏紧） |
| 盘 | `/dev/sda15` 约 50G（2026-08-29 已用约 3.4G） |
| 系统 | Ubuntu 26.04 |
| 内核 | `7.0.0-umeko-rv0-dirty` |
| Docker | **29.1.3**（到机时已在跑） |
| 局域网 | Wi-Fi **`192.168.1.130`** |
| SSH | `ssh root@192.168.1.130` |
| 公网 SSH | `ssh -J root@server.mnnumath.vip -p 8092 root@127.0.0.1` |
| npc | NPS client **2** `phone1-xiaomi5` |
| 宝塔 | 端口 **24396**，入口 `/abaff8a4`，系统 nginx（不要官方编译） |
| 测试站 | https://test.phone1.mnnumath.vip |
| 内核工程 | `~/Projects/xiaomi-gemini-mainline`（UFS，LK） |
| 规划可调度内存 | 预留系统+agent 后大约 **≤1.8 GiB**，单独吃不下「2Gi 配额占满 + 系统」 |

---

## ginkgo · Redmi Note 8

| 项 | 值 |
|----|-----|
| SoC | Qualcomm **SM6125**（骁龙 665），aarch64 |
| 内存 | 硬件约 5.5 GB；主线内核可见约 **4044 MB**（pmOS 调研笔记） |
| 系统 | Ubuntu 26.04 + GNOME |
| 显示 | 默认天马 NT36672A 1080×2340；另有华星批次 |
| GPU | Adreno 610 |
| Wi-Fi | WCN3990 / `ath10k_snoc` |
| Docker | **29.7.2**（清华 docker-ce；内核需 iptables/veth/overlay） |
| USB 网 | 电脑 `192.168.7.1`，手机 **`192.168.7.2`**（RNDIS） |
| Wi-Fi | DHCP，曾见 `192.168.1.124`（会变） |
| SSH USB | `ssh root@192.168.7.2` |
| 公网 SSH | `ssh -p 8089 root@106.52.109.127`（安全组已放行 8089） |
| npc | NPS client **1** `ginkgo`；**经常 offline**（关机/没联网） |
| 宝塔 | 端口 **33144**，入口 `/f730fa4d` |
| 测试站 | https://test.phone.mnnumath.vip |
| 内核工程 | `~/Projects/xiaomi-ginkgo-mainline`（ABL，eMMC，有 dtbo/vbmeta） |
| T4 规划 | 第一台 **arm64 phone worker**；虚 IP **`10.88.0.11`**；join 见 [deploy/t4/README.md](../deploy/t4/README.md)（**2026-09-06 离线**，LAN/NPS 均未通） |
| 规划 | 三台手机里相对最能扛一点内存；仍是电池机，NotReady 是常态 |

---

## vince · Redmi Note 5 / 5 Plus

| 项 | 值 |
|----|-----|
| SoC | Qualcomm **MSM8953**（骁龙 625），**8× Cortex-A53** |
| 内存 | 约 **3.5 GiB**（实测 `free` 3543 MiB） |
| 盘 | userdata ext4 已扩到约 **53G** |
| 系统 | Ubuntu 26.04 |
| 内核 | `7.0.9-g5be94b504b80-dirty` |
| Wi-Fi | WCN3660B / `wcn36xx`，双频 11n 1×1 40 MHz（PHY 上限约 150 Mbit/s） |
| 局域网 | Wi-Fi **`192.168.1.154`**（会随 DHCP 变） |
| SSH | `ssh root@192.168.1.154` |
| 公网 SSH | `ssh -J root@server.mnnumath.vip -p 8095 root@127.0.0.1` |
| USB 控制台 | `/dev/ttyACM0` 115200（`g_serial`） |
| npc | NPS client **3** `vince`，vkey 见凭据文件 |
| 宝塔 | **未装完**（Ubuntu 26 缺 libpcre3、安装脚本会重开 ufw） |
| 测试站 | https://test.phone2.mnnumath.vip （站点未验收） |
| Docker | 包曾安装；NAT 模块随 boot 镜像 |
| 内核工程 | `~/Projects/xiaomi-vince-mainline`（LK，eMMC，`pagesize=2048`，boot 分区 16MiB） |
| 刷机 | 必须 **USB 2.0**（这颗 LK 与 USB 3.x 不兼容） |

### vince 网络限制（调度时当约束）

详见 `xiaomi-vince-mainline/docs/zh-CN/wcn36xx-rx-mcs0-hud.md`。摘要：

- **灭屏** LAN iperf3 下载约 **100 Mbps**，RX MCS 7。
- **亮屏 HUD 刷 fb0** 时 5G 下载可到约 **6 Mbps**。
- HUD 曾在熄屏时把八核打成 `powersave` **652.8 MHz**，AP 把下行锁在 MCS 0，须重关联才恢复；现已禁止改 governor。
- 拉镜像、同步、备份应假设节点**灭屏**。

---

## dev-pc · 开发机

| 项 | 值 |
|----|-----|
| 主机名 | `huanghuabin-MS-7E61` |
| 局域网 | **`192.168.1.148`**（2026-09-06） |
| EasyTier 试连 | **`10.88.0.30/16`**（T2；`easytier` 网卡） |
| CPU / 内存（实测） | **8 核**；物理 **30 GiB**；agent 上报可售 **~29.4 GiB** |
| T4 Path A | 本机 `ha-api` + Incus（`incusbr0` `10.99.0.0/24`）；`POST …/workspaces` plan=`nano` → `ha-*` RUNNING |
| SSH 到各手机 | `sshpass` / 密钥；常见密码见凭据文件 |
| 用途 | kubectl / 构建 / **LAN Depot** / **T4 amd64 worker（Path A 验收机）** |

---

## 规划容量（粗算，给 Quota 用）

系统 + k3s agent 预留按 **~800Mi 内存、0.5–1 核** 计，**不是精确值**：

| 节点 | 物理核（约） | 粗算可 request 内存 | 备注 |
|------|----------------|---------------------|------|
| phone1 | 4（820 为 2+2 集群） | ~1.8 Gi | 最紧 |
| ginkgo | 8（665） | ~3 Gi | 内核可见 ~4G |
| vince | 8×A53 | ~2.7 Gi | 灭屏网络才稳 |
| **arm64 手机合计** | | **~7.5 Gi** | 全部在线时 |
| dev-pc（T4 Path A） | **8** | **~29 GiB** 可售 | Incus + ha-agent 已验收 |
| VPS | 2 × Xeon 8255C | 控制面可售 **0** | 内存仅 ~1.9 Gi，不跑用户 Workspace |

「项目 4 核 2G」在**单台 phone1 上放不满**；x86 主机通常可以。套餐必须带 arch，两池不能混卖。

---

## 旁路仓库（内核，不是本平台）

| 机器 | 路径 |
|------|------|
| vince | `~/Projects/xiaomi-vince-mainline` |
| ginkgo | `~/Projects/xiaomi-ginkgo-mainline` |
| gemini / phone1 | `~/Projects/xiaomi-gemini-mainline` |
| 旧日记 / 宝塔 NPS | `~/Projects/Workspace/docs/` |
