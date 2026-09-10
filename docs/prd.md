# PRD：分散机器上的高可用容器平台 + 项目级虚拟配额

> 仓库：`~/Projects/ha-cluster`  
> 起草：2026-09-06  
> 状态：**需求冻结草案（尚未实现）**  
> 相关台账：[inventory.md](inventory.md)  
> 落地设计：[implementation/00-index.md](implementation/00-index.md)（含用户系统、协作、隔离 SSH、跳板、硬占用、HA、一包安装、异构节点、**EasyTier 公共中枢**；冲突时以实施文档「产品拍板」为准）

**勘误（P1 运行时）：** 用户申请的「机器」= **Incus Workspace**（见 [implementation/22-project-machine-concepts.md](implementation/22-project-machine-concepts.md)）。k8s Namespace 为可选运行时（见 [27-project-monitoring-and-runtimes.md](implementation/27-project-monitoring-and-runtimes.md)），非默认路径。框架分层见 [31-framework-layers.md](implementation/31-framework-layers.md)。

---

## 1. 背景与问题

手上已经有多台能跑 Ubuntu / Docker 的机器，但它们**不能当成一个机柜里的一组刀片**：

| 现实 | 后果 |
|------|------|
| 物理上分散：几部 Linux 手机 + 一台腾讯云 VPS + 一台开发 PC | 没有共享二层、没有机架内网、没有 IPMI |
| 手机在 NAT / 运营商网后，公网 IP 会变 | 不能让 worker 直接暴露 Kubernetes API / NodePort 到公网 |
| 手机经常关机、没电、Wi-Fi 差、npc 掉线 | 节点 NotReady 是常态，不是事故 |
| 全是 **aarch64**（手机）对 **amd64**（VPS / 本机） | 镜像要多架构或只在 arm64 worker 上跑 |
| 单机内存只有 2.6–4 GiB 量级 | 「一台手机 = 一个项目」会立刻打满；必须**切片** |
| 现在的用法是每台 SSH + 宝塔 + 手工容器 | 项目一多就无法协同、无法配额、无法迁移 |

已经有的、可以复用的基础设施：

- VPS 常驻：`106.52.109.127`，证书、OpenResty、**NPS**（`server.mnnumath.vip:8088`）
- 每台手机一个 npc 客户端，TCP 隧道到 VPS（SSH / HTTP / 面板）
- 域名 `*.phone.` / `*.phone1.` / `*.phone2.mnnumath.vip` 已指向 VPS

**要做的不是再买一台机房服务器**，而是：在这些「不听话的节点」上，做出接近 k8s 的**项目配额 + 部署体验**，并且控制面高可用（至少：手机全灭时，API 和入口还在 VPS 上）。

---

## 2. 目标用户与场景

**用户：** 自己（以及以后可能的协作者），在这些机器上跑小服务、实验、站点、构建任务。

**典型场景：**

1. 新建项目 `homework-api`，申请 **4 核 2G**（虚拟配额，不是独占一台手机）。
2. 用 `kubectl apply -f deploy.yaml` 或等价 CI，把工作负载调度到**当时在线**的 worker。
3. 某台手机没电下线：Pod 在别的在线节点上被拉起（允许短暂中断）；入口域名仍从 VPS 进。
4. 配额超了（项目已经用掉 2G）再发 Pod，被 API 拒绝，而不是把整台手机 OOM 死机。
5. 不想关心「这个容器现在在 ginkgo 还是 vince 上」。

---

## 3. 产品目标（必须有）

1. **项目 = 隔离单元**  
   创建项目时指定虚拟规格，例如：`cpu: "4"`，`memory: 2Gi`，可选存储上限。  
   实现上对应 Kubernetes **Namespace + ResourceQuota + LimitRange**（第一期不必上 vCluster）。

2. **按 k8s 语义部署**  
   支持 Deployment / Job / Service / ConfigMap / Secret / Ingress（或 Gateway）。  
   镜像从本机或公开仓库拉取；手机架构为 `linux/arm64`。

3. **控制面高可用（相对节点）**  
   - API Server / etcd（或 k3s sqlite/embedded）跑在 **VPS**（amd64，常驻）。  
   - 手机只做 **agent / kubelet**。  
   - 全部手机离线时：`kubectl` 仍可连上，Ingress 在 VPS 返回 502 而不是 DNS 失效。  
   - 第一期 **不做** 双控制面（只有一台 VPS）；「高可用」先定义为 **worker 可消失，控制面不跟着消失**。双 VPS 列为二期。

4. **节点可随时加入/退出**  
   新机器（**x86 Linux 或 ARM 手机/SBC**）已有 Ubuntu + SSH 后，用安装器加进集群：输入 root 密码即完成（见 [implementation/10-fast-installer.md](implementation/10-fast-installer.md)）。  
   节点 NotReady 超过阈值，工作负载转到其他 **同架构** Ready 节点（需至少 2 个对应 arch 的 worker 在线才谈得上迁移）。

5. **入口统一**  
   公网 TLS 继续只在 VPS 终结（现有 OpenResty / 证书）。  
   集群内 Service 经 Ingress 或 NPS 转到对应 NodePort/Host。不把 80/443 让给 NPS。

6. **资源账本可解释**  
   「4 核 2G」是 **调度配额**，不是 KVM 虚拟机。  
   超售策略写进配置：例如物理 CPU 可 200% 超售，内存默认 **不超售**（手机 2.6G 超售会直接 OOM）。

---

## 4. 非目标（第一期明确不做）

- 不做完整公有云（计费、多租户控制台、自动扩容买机器）。
- 不做在手机上跑控制面（电量、NAT、Wi-Fi RX 问题都不适合 etcd）。
- 不做跨架构混部**同一个** Workspace/Pod（集群内同时存在 amd64 与 arm64 节点是允许的；镜像必须与节点 arch 一致）。
- 不做把 Windows / Android 应用当容器。
- 不做替换 NPS 为 WireGuard 专网（**集群底盘改为 EasyTier**；NPS 仅遗留 HTTP 站点）。
- 不保证手机亮屏刷 HUD 时网络满速（vince 上已实测：灭屏 ~100 Mbps，亮屏 HUD 时 5G 下载可掉到 ~6 Mbps）。调度和镜像拉取应默认假设节点灭屏/无桌面负载。

---

## 5. 成功标准

第一期（MVP）验收：

| # | 标准 |
|---|------|
| 1 | `kubectl get nodes` 能看到 VPS（control-plane）+ 至少 1 台手机 worker |
| 2 | `kubectl create ns demo &&` 写入 ResourceQuota `cpu=4, memory=2Gi` |
| 3 | 在该 ns 部署一个 arm64 `Deployment`（如 `nginx`），有 Ready Pod |
| 4 | 通过 VPS 域名或 Node 隧道能访问该服务 HTTP |
| 5 | `kubectl delete pod` 后 Deployment 再拉起 |
| 6 | 人为让该 worker 断网：Pod 变 NotReady；worker 回来后恢复。若有第二 worker，可验证迁移 |
| 7 | 再部署超出 2Gi 的 Pod，被 Quota 拒绝 |
| 8 | 文档里每台设备的加入步骤可重复 |

---

## 6. 方案选型（草案）

### 6.1 集群发行版

**推荐第一期：k3s。**

| 选项 | 为何选/不选 |
|------|-------------|
| **k3s** | 单二进制、arm64 官方支持、server 可放 VPS、agent 放手机、资源占用适合 2–4G 内存节点 |
| kubeadm 全量 | 手机内存和运维成本不合适 |
| k0s | 也可，生态比 k3s 小 |
| Nomad | 不是「k8s 方式」 |
| Docker Swarm | 配额和生态弱于 k8s |
| 每台独立 k3s + 联邦 | 第一期过重 |

拓扑：

```
                    ┌─────────────────────┐
   kubectl / CI     │  VPS amd64 常驻      │
        │           │  EasyTier 10.88.0.1  │
        │           │  k3s / OpenResty     │
        │           │  NPS 仅遗留站点      │
        └──────────►│                      │
                    └──────────┬──────────┘
                               │ EasyTier overlay
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        任意网络 worker   任意网络 worker   任意网络 worker
        (手机 / x86)      (手机 / x86)      (手机 / x86)
```

kubelet → apiserver 必须走 **EasyTier 虚 IP**（`https://10.88.0.1:6443`），不能依赖手机公网 IP，也不再为每台开 NPS 6443 隧道。

NPS 每台手机已有的 SSH/HTTP 隧道**保留给旧站点**，不扩展为集群通道。

**优先：VPS 跑 EasyTier 中枢（11010/11011）；6443 仅 overlay。** 详见 [implementation/12-easytier.md](implementation/12-easytier.md)。

### 6.2 项目与「虚拟机」抽象

用户说的「创建项目，分配 4 核 2G」**不是** KVM 虚机，第一期映射为：

| 用户语言 | k8s 对象 |
|----------|----------|
| 项目 | Namespace `proj-<name>` |
| 4 核 2G | ResourceQuota：`requests.cpu=4` `requests.memory=2Gi`（以及可选 `limits.*`） |
| 默认容器规格 | LimitRange：例如默认 request `100m/128Mi`，limit 不超过配额 |
| 谁能部署 | 该 ns 的 kubeconfig（ServiceAccount + Role） |

可选二期：

- **vCluster**：每个项目一个虚拟控制面（隔离更强，开销更大，2G 手机上要小心）
- **KubeVirt / Firecracker**：真虚机，当前硬件不适合当主路径
- **CPU Manager / 固定绑核**：手机上收益有限

超售：

- CPU：允许 `requests` 之和 > 物理核（A53 适合超售），建议系数 2。
- 内存：默认系数 1.0。phone1 仅 2.6 Gi，系统 + k3s agent + kubelet 预留 **至少 800Mi**，可调度内存约 **1.8Gi**，因此「4 核 2G」**不能**全部落在 phone1 一台；必须跨节点或拒绝。

调度器要用：

- `nodeSelector` / `kubernetes.io/arch=arm64`
- 污点：控制面 VPS `NoSchedule`（不跑业务，除非显式容忍）
- 预留：kubelet `kubeReserved` + `systemReserved`

### 6.3 网络

现网：VPS OpenResty 反代到 `127.0.0.1:809x` → npc → 手机 `:80`。

集群后：

- ClusterIP 仅集群内。
- 公网：Ingress 放在 **VPS**（Traefik 或继续 OpenResty 反代到 Ingress NodePort）。
- 手机之间默认 **没有** 直连 Pod 网；k3s 默认 Flannel VXLAN 在 NAT 后经常失败。

**第一期网络策略（必须写进实现）：**

1. **第一期网络策略：** 全节点加入 EasyTier；承诺虚 IP 互通（打洞或经 VPS 中继）。不把 Flannel VXLAN 当「4G 互访一定能通」的唯一手段——底层先通 overlay。  
2. NPS 不承担新的 east-west。  
3. 不把 Flannel VXLAN 裸跑在运营商网上。

### 6.4 存储

手机 eMMC，掉电即风险。

- 默认：`emptyDir`。
- 需要持久：节点本地 `hostPath` 或 local-path-provisioner，**不跟随 Pod 迁移**。
- 真正要迁移的数据：对象存储 / VPS 磁盘 / NFS（VPS 当 NAS）。第一期文档写清「持久卷不跨手机漂移」。

### 6.5 镜像

- 业务镜像：`linux/arm64`。
- 本机构建：`docker buildx --platform linux/arm64`。
- 手机拉 Docker Hub 可能很慢；可在 VPS 或本机 registry，经 NPS HTTP 隧道给 agent。

---

## 7. 功能范围

### 7.1 MVP

- 安装文档：VPS k3s server、手机 k3s agent、防火墙/NPS/6443
- `scripts/`：生成项目 Namespace + Quota 的清单（例如 `4c2g` 模板）
- 示例 Deployment + Ingress
- 节点标签：`phone=vince|ginkgo|phone1`，`power=battery`，`arch=arm64`
- 监控最小集：`kubectl top` 或 metrics-server；节点掉线告警可后补

### 7.2 二期

- 小 Web 控制台：「创建项目 / 选套餐 / 下载 kubeconfig」
- 多控制面或 etcd 备份到对象存储
- WireGuard 全节点组网，打通跨节点 Service
- GPU（ginkgo Adreno / vince Adreno 506）不进通用调度
- CI：本机 push → 集群 pull

---

## 8. 约束与风险（必须当需求，不当意外）

| 风险 | 事实 | 对产品的含义 |
|------|------|----------------|
| 节点离线 | ginkgo npc 经常掉线；手机没电 | 副本数 ≥2 才谈 HA；单副本服务会随节点睡 |
| 内存小 | phone1 ~2.6Gi；vince ~3.5Gi | 套餐「4c2G」可能跨节点；单节点 Quota 要小于可调度内存 |
| 架构 | worker 全 arm64 | 禁 amd64 业务镜像上手机 |
| vince Wi-Fi | 灭屏下载 ~100 Mbps；亮屏 HUD 可掉到 ~6 Mbps；曾 MCS0 锁死 | 拉镜像、iperf、备份安排在灭屏；详见 `xiaomi-vince-mainline/docs/zh-CN/wcn36xx-rx-mcs0-hud.md` |
| Ubuntu 26 | 宝塔/部分 deb 缺 `libpcre3` | 集群组件用静态二进制（k3s），不要依赖宝塔装 k8s |
| 隧道 | 不要占用 8088–8097 已有 NPS 口 | 新端口从 8098 起编，或复用已有 SSH 做反向 |
| 安全组 | 8092/8095 SSH 默认不对公网 | agent 连 API 不要走这些口硬编码当唯一路径 |
| 磁盘 | eMMC 寿命、突然拔电池 | 不把 etcd 放手机 |

---

## 9. 套餐建议（虚拟规格）

面向「项目配额」的预设，可改：

| 套餐名 | CPU request 总和 | 内存 request | 说明 |
|--------|------------------|--------------|------|
| `nano` | 500m | 256Mi | 静态站 |
| `small` | 1 | 512Mi | 小 API |
| `medium` | 2 | 1Gi | |
| `large` | 4 | 2Gi | 用户举例；**不要**调度到只剩 &lt;2Gi 可分配的节点 |
| `xlarge` | 6 | 3Gi | 可能需要 ginkgo+vince 两台同时在线 |

创建项目时生成：

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: project-quota
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 2Gi
    limits.cpu: "8"
    limits.memory: 2Gi
    pods: "20"
```

---

## 10. 里程碑

| 阶段 | 内容 | 依赖 |
|------|------|------|
| M0 本文档 | PRD + 设备台账 | 完成（本仓库） |
| M1 控制面 | VPS 安装 k3s server，kubeconfig 在开发机可用 | 安全组 / 6443 |
| M2 第一 worker | phone1 或 vince 加入，跑示例 nginx | npc 在线、arm64 镜像 |
| M3 配额 | 项目模板 4c2g，超配额拒绝 | |
| M4 入口 | 某一 `*.mnnumath.vip` 指到集群 Ingress | OpenResty 反代 |
| M5 第二 worker | 两台手机，杀一台看能否迁 | 两台同时在线 |
| M6 文档固化 | 加入/剔除节点 runbook | |

---

## 11. 文档与仓库边界

- **本仓库**：平台产品（PRD、安装脚本、清单、以后 Helm/YAML）。
- **不替代**：`xiaomi-*-mainline`（内核）、`Workspace/docs`（旧的宝塔/NPS 日记）。
- 密码只放 `docs/credentials.local.md`。

---

## 12. 开放问题（实现前要拍板）

1. k3s agent 连 API：只走 EasyTier `10.88.0.1:6443`（已拍板）。  
2. 跨节点互通：承诺 overlay 虚 IP；带宽视路径（P2P vs 中继）。  
3. 「4 核」按 request 做配额，limit 防失控。  
4. 是否允许业务跑在 VPS（amd64）？建议默认否（控制面污点）。**允许**业务跑在其他 amd64 Linux worker 上。  
5. 加节点是否必须 npc？**否。** 一律 EasyTier；npc 仅遗留站点。
