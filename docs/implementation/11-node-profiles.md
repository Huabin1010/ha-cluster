# 11 · 异构节点画像（x86 主机与 ARM 设备一等公民）

> 上级：[00-index.md](00-index.md)  
> 安装：[10-fast-installer.md](10-fast-installer.md)  
> 账本：[07-resource-ledger.md](07-resource-ledger.md)

---

## 1. 重新定位

早期文档容易把集群写成「VPS 控制面 + 几台 Linux 手机」。那是**当前库存**，不是产品边界。

**产品边界：** 任何能跑受支持 Linux 的机器都可以成为节点——**amd64（x86_64）主机与 arm64 设备同为一等公民**。手机只是其中一类「电池 + NAT + 小内存」的 worker。

| 类别 | 典型 | 架构 | 电源 | 网络 | 适合 |
|------|------|------|------|------|------|
| 云主机 | 腾讯云 VPS | amd64 | 市电 | 公网 | 控制面、入口、Depot 回源 |
| 桌面/塔式/小主机 | 开发机、以后的 NUC、二手 PC | amd64 | 市电 | LAN / 公网 | **主力 worker**、LAN Depot、可选第二控制面 |
| SBC | 树莓派、同类 | arm64 | 常电或电源砖 | LAN | worker |
| Linux 手机 | phone1 / ginkgo / vince | arm64 | **电池** | NAT / 蜂窝 / Wi-Fi | worker（可随时 NotReady） |

调度、账本、安装器、镜像仓库都必须按这个矩阵工作，而不是写死 `arch=arm64`。

---

## 2. 对架构的影响（相对旧稿）

| 旧假设 | 新假设 |
|--------|--------|
| 业务镜像默认 arm64 | **Workspace 必须带 arch**；用户可选 `amd64` / `arm64` / `any`（any 仅当镜像为 multi-arch） |
| 开发机不当 worker | 开发机**可以**当 worker 或 depot；默认不跑控制面 etcd |
| 跨架构混部禁止 | **禁止同一 Workspace 在运行时换架构**；集群内同时存在两种节点完全允许 |
| 真微虚机遥遥无期 | **有 KVM 的 x86 主机**上，P3 可开 Firecracker/KubeVirt；手机仍走 Incus |
| 资源池 ≈ 三台手机内存和 | 池按 `arch × power × region` 切开，**不可把 amd64 空闲拿去卖 arm64 套餐** |

---

## 3. 节点画像（Profile）

安装器探测后写入标签与账本。调度只看标签，不看「是不是手机」。

### 3.1 标准标签

```
kubernetes.io/arch=amd64|arm64
ha-cluster.mnnumath.vip/role=control-plane|worker|depot
ha-cluster.mnnumath.vip/power=mains|battery
ha-cluster.mnnumath.vip/network=public|lan|nat
ha-cluster.mnnumath.vip/runtime=incus|k3s|kvm|both
ha-cluster.mnnumath.vip/class=phone|sbc|desktop|server|cloud
ha-cluster.mnnumath.vip/tunnel=easytier
```

### 3.2 画像模板

**cloud-control（现 VPS）**

- role: server+depot；power: mains；network: public；arch: amd64
- 污点：默认不为用户 Workspace 调度（避免把入口机打满）
- 可选手动：允许少量 `system` 工作负载

**x86-worker（桌面 / 小主机）**

- role: worker；可选 worker+depot
- power: mains → 调度**优先**于电池节点
- network: 任意；**一律 EasyTier**
- runtime: incus；若 `/dev/kvm` 存在则 `runtime` 可含 kvm
- 预留：系统 + agent 建议 ≥ 2Gi 内存、1 核（桌面还要给 GUI 留余量，探测有图形会话则 `ha_reserved` 加大）

**arm-phone**

- power: battery；network: nat；tunnel: **easytier**（不靠 npc 入集群）
- 内存预留 ≥ 800Mi
- 禁止 role=server
- 大套餐可能单机装不下（phone1）

**arm-sbc**

- 常电则 power=mains；其余同 worker

---

## 4. 调度策略（多架构）

创建 Workspace 时：

```
spec:
  arch: amd64 | arm64 | any
  class_prefer: mains > battery
  runtime: incus | kvm   # kvm 仅节点有 KVM 时
```

规则：

1. **硬过滤 arch**（`any` 需要镜像同时提供两架构 digest）。
2. 硬过滤容量（账本 remaining ≥ 套餐）。
3. 打分：`mains` > `battery`；同档选剩余内存多的；`class=phone` 降权。
4. **禁止** qemu-user 翻译跑异架构（默认关；打开算实验，且必须另计价）。
5. 重建 Workspace 时 arch 不变；换 arch = 新机器。

控制台：套餐可绑定默认 arch（例如 `large-x86`、`large-arm`），避免用户不知道选哪个。

---

## 5. 资源池切分

见账本；这里强调**不能混卖**：

```
pool-amd64-mains     ← 所有 amd64 + 市电 worker
pool-arm64-mains     ← 树莓派等
pool-arm64-battery   ← 三台手机
pool-amd64-control   ← VPS 可售关闭
```

`large = 4c2g` 在 amd64 主机上通常**可以**单节点放下；在 phone1 上不行。同一套餐名可以跨池，但 Allocation 必须落到**某一个**节点+池。

x86 主机加入后，集群可售内存可能从 ~7.5Gi 跳到「主机剩余 + 手机」。硬占用语义不变：卖出即扣减。

---

## 6. 网络差异

**没有「LAN 直连 / NAT 走 npc」两套集群路径。** 全部节点先入 EasyTier，再用 `10.88.0.x`。

| 物理位置 | overlay | 用户 SSH | 节点互访 |
|----------|---------|----------|----------|
| 公网 VPS | `10.88.0.1` 中枢 | Bastion 在此 | 中继别人的流量 |
| 家宽 / 公司网 / 4G 手机 | 打洞或中继 | 仍只连 Bastion | 虚 IP 互通 |
| 与开发机同 LAN 的 x86 | 往往 P2P，延迟更好 | 同上 | 同上 |

安装器不根据 NAT 去装 npc。  
**用户永远只连 Bastion。** 管理员笔记本若要 `kubectl`，自己也加 EasyTier 或 SSH 到 VPS。

---

## 7. 运行时能力差异

| 能力 | 手机 | 普通 x86 主机 | 有 KVM 的 x86 |
|------|------|----------------|----------------|
| Incus 系统容器 | ✓ 主路径 | ✓ 主路径 | ✓ |
| k3s agent | ✓ | ✓ | ✓ |
| Docker-in-Workspace | 慎用 | 可开，另计配额 | 可 |
| Firecracker / Kata | 基本否 | 视嵌套 | **P3 可选真微虚机** |
| 大磁盘 / 快照 | eMMC 风险 | 适合 | 适合 |
| 当 Depot | 不适合 | **适合** | 适合 |
| 当控制面 | **禁止** | 二期可以 | 可以 |

对用户仍只暴露 Workspace；有 KVM 时 `runtime=kvm` 作为套餐选项，而不是另一套产品。

---

## 8. 当前库存如何套画像

| 机器 | 建议 profile | 备注 |
|------|----------------|------|
| vps-1 | cloud-control + **EasyTier 中枢** + depot | 不跑用户 Workspace |
| huanghuabin-MS-7E61 | x86-worker 或 depot（先 Depot 利于快装） | 同样跑 easytier-core |
| phone1 / ginkgo / vince | arm-phone | **入 EasyTier**；npc 仅留旧站 |

以后新买的「闲置 amd64 Linux」：U 盘或 `add-node` + root 密码即可，不必改代码。

---

## 9. 容量与预留经验值

安装器实测 `nproc` / `MemTotal` / 磁盘后写入账本；下列为**默认预留**（可覆盖）：

| class | system+ha reserved RAM | reserved CPU |
|-------|------------------------|--------------|
| phone | 800Mi | 500m–1000m |
| sbc | 512Mi–1Gi | 500m |
| desktop（有 GUI） | 2–4Gi | 1000m |
| server/cloud worker | 1–2Gi | 500m |
| control-plane | 整机默认可售 = 0 | — |

---

## 10. 验收

1. 一台 amd64 Ubuntu 与一台 arm64 手机都能 `add-node` 成功，控制台同时显示两种 arch。  
2. 创建 `arch=amd64` 的 Workspace **不会**落到手机。  
3. 创建 `arch=arm64` **不会**落到 x86（除非镜像明确 multi-arch 且用户选 `any`）。  
4. 市电 x86 与电池手机同时空闲时，默认优先 x86（可在审计日志看到打分）。  
5. VPS 默认仍无用户 Workspace。

回到总览：[00-index.md](00-index.md) · 下一篇：[12-easytier.md](12-easytier.md)
