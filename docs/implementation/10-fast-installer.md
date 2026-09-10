# 10 · 一包安装器（快速、异构、输入 root 密码即完成）

> 上级：[00-index.md](00-index.md)  
> 节点类型：[11-node-profiles.md](11-node-profiles.md)

---

## 1. 要解决的体验

管理员（或设备主人）拿到**一个安装包**，对一台已经能 SSH 的 Linux 机器：

1. 填（或被询问）**root 密码**（或 sudo 密码）
2. 跑完
3. 机器已经成为集群节点：依赖装好、加入控制面、容量上报、可调度

不要求用户会 k3s、Incus、NPS、apt 源、多架构镜像。

适用对象（同一套安装器）：

| 设备 | 架构 | 例子 |
|------|------|------|
| 云主机 / 小机房 PC | **amd64 (x86_64)** | 腾讯云 VPS、开发机、以后新加的 Linux 主机 |
| Linux 手机 / SBC | **arm64** | phone1 / ginkgo / vince、树莓派类 |
| 同机二次安装 | 任意 | 幂等：已装则跳过下载，只校准配置 |

**非目标：** Windows、原生 Android app、macOS 作为 worker。macOS/Windows 只可当「发起安装的管理端」。

---

## 2. 设计原则

1. **用户只接触一个入口**：`ha-setup`（本地执行或远程推送）。
2. **架构自动识别**：`uname -m` → 拉对应 payload，禁止把 amd64 包装到手机。
3. **快**：默认不从公网零散拉 Docker Hub / GitHub；走 **Depot（制品库）** 或安装包旁的离线 payload。
4. **幂等**：同一台机器跑两次 = 修复/升级，不重复占资源、不破坏已有 Workspace。
5. **密码只用一次**：仅用于首次 SSH/sudo；装完改用密钥；**不写入** PostgreSQL / Git。
6. **角色一条命令**：`--role server|worker|depot|combo`。
7. **失败可回滚或可续跑**：阶段打点；断网后续跑从断点继续，不必从头下包。

---

## 3. 用户看到的两种用法

### 3.0 公网 CDN 一键加节点（推荐：新机器有公网）

**执行人：`platform_admin`**（平台最高管理员）。先在控制台生成 join token，再在目标机执行（可 SSH 远程）。项目 `owner`/`admin` **不能**自行加宿主机。

目标机只需 root，从 RustFS（bucket `typora`）拉瘦脚本 + 离线 payload：

```bash
curl -fsSL https://rustfs.s.ggss.club:50000/typora/ha-cluster/install.sh \
  | sudo bash -s join --token 'ha://join/<cluster>/<secret>?et_net=ha-cluster-easytier&et_peer=tcp://110.40.229.62:15010&api=https://<控制台>/api&depot_public=https://rustfs.s.ggss.club:50000/typora/ha-cluster'
```

发布与凭据见 [28-depot-cdn-one-click-install.md](28-depot-cdn-one-click-install.md)。

### 3.1 远程一键加入（推荐：坐在开发机上）

管理端已有 `ha-setup`（或完整包）。集群已初始化过，手里有 join token。

```bash
./ha-setup add-node \
  --host 192.168.1.130 \
  --user root \
  --role worker
# 提示：Target root password:
# （输入后 SSH 推送 payload、远程安装、join、打印成功）
```

等价交互：

```text
$ ./ha-setup add-node
Host [ip or dns]: 192.168.1.154
SSH user [root]: 
Role [worker]: 
Password: ********
Detecting: aarch64  Ubuntu 26.04  3.5Gi RAM
Using depot: http://192.168.1.148:9090  (LAN)
Uploading payload-linux-arm64 … done (12s)
Installing k3s-agent, incus, ha-agent … done
Node vince joined. allocatable: cpu=7.0 mem=2.7Gi disk=48Gi
```

### 3.2 机上本地安装（U 盘 / scp 一个文件）

把包拷到目标机：

```bash
sudo ./ha-setup join --token 'ha://join/…'
# 若无 token：sudo ./ha-setup init --role server
```

本地模式用 sudo 密码，不再需要 SSH。

---

## 4. 包长什么样（为什么能「一个安装包」）

公网/发给用户的是 **瘦引导包**（几 MB，**无架构绑定**）：

```
ha-setup                 # POSIX shell + 内嵌/旁路的静态 ha-setup 二进制（可选）
ha-setup.sha256
README.txt
```

真正占体积的是 **按架构拆开的 payload**（不强制塞进同一个文件，否则手机要下载无用的 amd64 镜像）：

```
ha-payload-linux-amd64-<ver>.tar.zst
ha-payload-linux-arm64-<ver>.tar.zst
```

引导程序会按顺序找 payload：

```
1. 同目录 / 环境变量 HA_PAYLOAD_FILE
2. 本机缓存 ~/.cache/ha-cluster/payloads/ 或 /var/lib/ha-setup/
3. Depot URL（LAN 优先，见下）
4. 官方/VPS HTTPS 回源（最慢，仅兜底）
```

对「必须真的只有一个文件」的场景（给小白 U 盘）：提供 **makeself 自解压胖包**（按架构各做一个）：

```
ha-node-linux-amd64-<ver>.run    # 引导 + amd64 payload
ha-node-linux-arm64-<ver>.run
```

用户命令仍是：`sudo ./ha-node-linux-arm64-*.run` → 问角色与 token → 结束。

控制台下载页按「这台电脑的 arch」给对应 `.run`，并提供「我要从 Windows/Mac 装远程 Linux」时用瘦包 + `add-node`。

---

## 5. Depot：快的关键

手机直拉 GitHub/Docker Hub 会极慢（vince 亮屏可掉到数 Mbps）。  
x86 主机若每台各自 apt upgrade + 拉镜像，也会重复浪费。

### 5.1 Depot 是什么

一台（或控制面自带的）**制品 HTTP 服务**，只读发布：

| 路径 | 内容 |
|------|------|
| `/payloads/linux-amd64/<ver>/…` | k3s 二进制、airgap 镜像、incus debs、ha-agent、Workspace 底包 |
| `/payloads/linux-arm64/<ver>/…` | 同上，arm64 |
| `/meta/os-packages/<os>/<arch>/` | 预下载的 .deb 依赖（openssh、uidmap、iptables…） |
| `/join/manifest.json` | 当前推荐版本、校验和 |

默认端口：**9090**（仅内网 / SSH 隧道；不对公网裸放）。  
控制面安装时自动带 `--with-depot`（VPS 当回源）。  
LAN 上任意 x86 机器可 `ha-setup --role depot` 做**边车缓存**（从 VPS 拉一次，局域网分发）。

```
[构建机/CI] ──发布──► VPS Depot（公网回源，给异地）
                         │
                         ▼ 一次同步
              [开发机 LAN Depot] ──千兆──► 各手机 / 各 x86 主机
```

### 5.2 速度目标（验收用）

| 场景 | 目标 |
|------|------|
| LAN Depot，x86 worker，payload 已在 Depot | **≤ 3 分钟** 到 `node Ready` |
| LAN Depot，arm64 手机，灭屏、payload 已在 Depot | **≤ 5 分钟** |
| 目标机已装过同版本，只 rejoin | **≤ 30 秒** |
| 无 Depot、纯公网首次（不作为主路径） | 不设 SLA；安装器应警告并建议先起 Depot |

瓶颈应是「解压 + 导入镜像」，不是「现下 800MB」。

### 5.3 为何不用「每台 apt install」当主路径

- Ubuntu 版本不一（VPS 22.04、手机 26.04），包名/依赖会碎（已有 libpcre3 教训）。
- 手机 apt 源慢且不稳。
- 无法离线。

策略：**能静态二进制的用静态**（easytier-core、k3s、ha-agent）；必须用发行版包的（incus、cgroup 工具）打进 payload 的 **deb 缓存**。

---

## 6. Payload 内容清单

每个 `linux-<arch>` payload 至少包含：

| 组件 | 形式 | 备注 |
|------|------|------|
| easytier-core | **瘦包即带**静态二进制 | 先入网再拉 payload；见 [12](12-easytier.md) |
| k3s | 官方二进制 + airgap 镜像 | `--node-ip` = EasyTier IP |
| k3s install.sh | 冻结副本 | `INSTALL_K3S_SKIP_DOWNLOAD=true` |
| incus | 适配的 .deb + 依赖 | 按 Ubuntu 代号分子目录 |
| ha-agent | 静态 Go 二进制 | 心跳含 overlay rtt/path |
| Workspace 底镜像 | Incus tarball | 经 Depot overlay 导入 |

**不打进包：** 用户密码、join token、EasyTier 网络密钥明文仓库、kubeconfig、NPS vkey。密钥随 token 下发。

体积控制：arm64 payload 目标 **≤ 600–800 MiB**（含 k3s airgap + 最小 OS 镜像）；可用 zstd。x86 可略大。

---

## 7. 角色与安装步骤

### 7.1 角色

| `--role` | 安装什么 | 典型设备 |
|----------|----------|----------|
| `server` | EasyTier **中枢监听** + PostgreSQL + ha-api/web + Bastion + k3s server + Depot | 有公网的市电机（现 VPS） |
| `worker` | EasyTier **peer** + k3s agent + incus + ha-agent | 任意网络上的手机、x86 |
| `et-relay` | 仅 EasyTier 第二中继 | 另一台公网 x86 |
| `depot` | overlay 内 serve payload | 已入网的大磁盘节点 |
| `server+depot` | 默认控制面 | VPS |

不允许：`server` 装在 `power=battery` 的手机上（安装器直接拒绝）。

### 7.2 worker 流水线（远程 `add-node`）

```
A. 管理端：口令仅进内存（若目标此刻 SSH 可达）
B. 探测 arch / os；将瘦包中的 easytier-core 送到目标
C. 启动 EasyTier，peer=VPS；等待 ping 通 10.88.0.1
D. 从 Depot(10.88.0.1:9090) 拉对应 arch payload（异地也能下）
E. 装 incus / k3s-agent（K3S_URL=https://10.88.0.1:6443，node-ip=虚 IP）
F. 装 ha-agent，注册账本（上报 et_ip、path、rtt）
G. systemd：easytier 先于 k3s/agent
H. 抹掉密码；可选关闭密码登录
```

目标与管理端不在同一网络时：跳过 A，用户在目标机跑 `.run`，从 C 开始。

### 7.3 server 流水线（`init`）

```
装 easytier-core 为中枢（10.88.0.1，监听 11010/11011）
安全组放行 11010 UDP+TCP、11011；**不**放行 6443/9090 到公网
装 PostgreSQL → migrate
装 k3s server --node-ip=10.88.0.1 --flannel-iface=easytier
装 ha-api / web / bastion
起 Depot 绑 overlay
生成含 et_net / et_peer 的 join token
```

不覆盖 80/443；不占用 NPS 8088–8097。

---

## 8. Join token 与发现

一条 token 同时带齐：

```
ha://join/<cluster_id>/<secret>
  ?et_net=ha-<id>
  &et_peer=tcp://server.mnnumath.vip:11010
  &et_peer2=wss://server.mnnumath.vip:11011
  &api=https://10.88.0.1:8443
  &k3s=https://10.88.0.1:6443
  &depot=http://10.88.0.1:9090
```

瘦包内的 EasyTier 先用 `et_peer` 入网，之后 API/k3s/Depot **只走虚 IP**。完整字段见 [12](12-easytier.md) §7。

- `secret`：一次性或限次，可旋转
- overlay 起来后 Depot 用 `10.88.0.1`；同网段 P2P 时可走更近的 Depot 节点
- 过期/用过：API 拒绝

`add-node` 时管理端若已 `ha-setup login`，可自动向 API 申请 **短时 token**，用户甚至不用复制 token，只输入目标机密码。

---

## 9. 技术选型（安装器本身）

| 选项 | 评价 | 结论 |
|------|------|------|
| 纯 Ansible | 目标机要 Python；用户要写 inventory；手机 Ubuntu 26 依赖坑 | **内部可选用，不当用户入口** |
| cloud-init 专用镜像 | 改不了已有 Ubuntu 手机/主机 | 仅预装镜像场景 |
| **ha-setup：POSIX sh + 静态二进制（Go）** | 无依赖、双 arch 交叉编译、ssh 远程执行熟 | **采用** |
| makeself `.run` | 小白双击/一条命令 | 胖包发行格式 |
| k3s 官方 install.sh | 复用但必须 `SKIP_DOWNLOAD` + airgap | 被 ha-setup **调用**，不单独暴露 |

远程执行：OpenSSH + 密钥优先；密码用 `sshpass` 仅 bootstrap。不把 Ansible 作为必须前置。

管理端最低依赖：Linux/macOS 能跑 `ha-setup`；Windows 可用 WSL 或只发 `.run` 让用户在目标 Linux 上执行。

---

## 10. OS / 内核兼容矩阵

安装器 **先探测再装**，不硬编码「全是 Ubuntu 手机」。

| OS | amd64 | arm64 | 说明 |
|----|-------|-------|------|
| Ubuntu 22.04 | ✓ 主 | ✓ | VPS |
| Ubuntu 24.04 | ✓ 主 | ✓ | 新 x86 主机 |
| Ubuntu 26.04 | 视包 | ✓ 手机现状 | 缺的库用 payload deb，禁止走宝塔脚本 |
| Debian 12 | P2 | P2 | 需要单独 deb 集 |
| 其他 | 拒绝并打印支持列表 | | |

内核检查：cgroup v2、overlay、veth、iptables/nft。失败则给出「缺模块」而不是装一半。

---

## 11. 安全

| 项 | 要求 |
|----|------|
| root 密码 | 仅 stdin / SSH_ASKPASS；不进 argv 列表过久；不写日志 |
| payload 完整性 | sha256 + 可选 minisign/age |
| join secret | TLS 提交；短期 |
| 安装后 | 部署 `ha-node` 主机密钥；可选关闭 PasswordAuthentication |
| 权限 | worker 上 ha-agent 最小权；incus 用 incus 组 |
| 回滚 | `--uninstall` 移除 agent/k3s/incus（**默认不删**用户 Workspace 盘，需 `--purge`） |

---

## 12. 失败、续跑、升级

状态文件：`/var/lib/ha-setup/state.json`（阶段、版本、checksum）。

```
ha-setup join …     # 从失败阶段继续
ha-setup upgrade    # 只换二进制/镜像，不改 join
ha-setup status     # 人读健康
ha-setup uninstall  # 见上
```

升级路径：Depot 上新 ver → 控制台「滚动升级节点」或节点上 `upgrade`。payload 增量（zstd 词典/rsync）为 P2。

---

## 13. 与现网 NPS / 宝塔的关系

- **不卸载** 宝塔/1Panel/NPS；避开 80/443/8088–8097。
- **集群不新开 npc 隧道。** 入网只靠 EasyTier。
- 已有 npc 可留着给旧域名；安装器不去抢。
- x86 与手机在 overlay 上无差别，不再「LAN 就直连 6443 公网」。

---

## 14. CLI 一览

```
ha-setup init [--role server+depot] [--bind-address …]
ha-setup add-node --host <ip> [--user root] [--role worker] [--token …]
ha-setup join --token <url>
ha-setup --role depot
ha-setup status | upgrade | uninstall [--purge]
ha-setup pack   # 维护者：从 CI 产物打 payload / .run
```

`add-node` 参数：`--password-file -` 从 stdin 读密码，便于脚本且不进 shell history。

---

## 15. 仓库与 CI

建议目录：

```
packaging/
  ha-setup/          # 引导程序
  payloads/          # 构建脚本，不提交巨大 tar
  dist/.gitignore    # 产出的 .run / .tar.zst
scripts/pack.sh
```

CI（可在开发机）：交叉编译 `linux/amd64` + `linux/arm64`，拉取冻结版本的 k3s/incus，打包，上传到 VPS Depot。

---

## 16. 验收清单

1. 开发机执行 `add-node --host <phone>`，只输入 root 密码，**不再手工 apt/k3s**。  
2. 同一命令对一台 amd64 Ubuntu 主机成功，且调度标签 `arch=amd64`。  
3. 断网后用 U 盘胖包 `.run` 仍能 join（Depot 不可达时用本地 payload）。  
4. 第二次执行不重复下载，30 秒内回到 Ready。  
5. 安装日志无密码明文。  
6. 装完账本出现节点 allocatable，且未超卖旧占用。  
7. 故意用 amd64 包在 arm64 上安装 → **拒绝**。  
8. 在手机上 `--role server` → **拒绝**。  
9. 异地/4G 节点 `ping 10.88.0.1` 通；6443 不对公网仍 Ready。

详见 [12-easytier.md](12-easytier.md)。

下一篇：[11-node-profiles.md](11-node-profiles.md)
