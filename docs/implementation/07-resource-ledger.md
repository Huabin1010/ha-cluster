# 07 · 资源账本与硬占用

> 上级：[00-index.md](00-index.md)  
> **本章是全平台硬约束，优先于调度器「看起来还有空闲」。**

---

## 1. 产品硬约束

> 凡分配给用户的 CPU、内存、磁盘（及可选端口、GPU），必须在中心账本中记为一笔 **Allocation**，并从可售池中**扣减**。  
> 在状态变为 `released` 之前，**不得**再次售卖给任何用户或项目。  
> 默认**禁止超售**。

这直接满足：「分配出去的资源要占用掉，不能额外分配」。

与早期 PRD「CPU 可 200% 超售」的关系：

| 模式 | 谁能开 | 用途 |
|------|--------|------|
| `strict`（默认） | 全局默认 | 多用户生产 |
| `oversell` | 仅 `platform_admin` 显式开启 | 单人自用实验 |

开启超售时 UI 大字警告；审计必记。

---

## 2. 容量模型

### 2.1 节点容量

对每个 worker：

```
raw_cpu, raw_mem, raw_disk          # 实测
system_reserved_*                  # OS / easytier / k3s / incus 守护预留
ha_reserved_*                      # 平台再留余量（防 OOM）
allocatable_* = raw - system - ha
```

台账粗算（来自 inventory，实施时以实测刷新）：

| 节点 | allocatable 内存（粗） | 备注 |
|------|------------------------|------|
| phone1 | ~1.8 Gi | arm64 battery，最紧 |
| ginkgo | ~3.0 Gi | arm64 battery |
| vince | ~2.7 Gi | arm64 battery，灭屏才稳 |
| **arm64-battery 合计** | **~7.5 Gi** | 三台手机全在线 |
| x86 主机（如开发机） | **实测 − 桌面预留** | `pool-amd64-mains`；加入后单独成池 |
| VPS | 默认可售 0 | 控制面 |

CPU 按 milliCPU；磁盘按该节点 Incus 池可用字节。**新节点以安装器实测为准写入账本**，上表只是库存草稿。

### 2.2 资源池（Pool）

可按标签聚合，**不同 arch 不得混卖**：

- `pool-arm64-battery`：Linux 手机  
- `pool-arm64-mains`：常电 arm 板  
- `pool-amd64-mains`：x86 Linux 主机  
- `pool-amd64-control`：VPS，默认可售关闭  

用户选套餐时必须带 `arch`（或套餐已绑定 arch）。amd64 主机上空闲的 16Gi **不能**拿去满足 `arch=arm64` 的 2Gi 请求。

售卖时从 Pool 的 `free_*` 扣减；同时落 `node_id` 占用（调度选定后绑定节点）。

**两阶段：**

1. `Reserve`：先扣 Pool（或扣「未绑定」），状态 `reserved`  
2. `Bind(node)`：落到具体节点；若节点不足则换节点或失败回滚  

也可一步：事务内选节点并扣节点容量（P1 推荐更简单）。

---

## 3. Allocation 状态机

```
reserved ──► active ──► released
    │           │
    └───────────┴──► released（失败补偿 / 销毁）
```

| 状态 | 计入占用 |
|------|----------|
| reserved | **是**（防超卖窗口） |
| active | **是** |
| released | 否 |

`stopped` 的 Workspace：默认 Allocation 仍为 **active**（见 [05](05-ssh-isolation.md) §3.1）。

---

## 4. 事务伪代码（防超卖核心）

```sql
BEGIN;

-- 锁住节点容量行
SELECT allocatable_mem, used_mem FROM node_capacity
WHERE node_id = $node FOR UPDATE;

-- 或锁池
SELECT free_mem FROM resource_pools WHERE id = $pool FOR UPDATE;

IF free_mem < need_mem OR free_cpu < need_cpu OR free_disk < need_disk THEN
  ROLLBACK; RAISE INSUFFICIENT_CAPACITY;
END IF;

UPDATE node_capacity
SET used_mem = used_mem + need_mem, ...
WHERE node_id = $node;

INSERT INTO allocations (... state='reserved') VALUES (...);

COMMIT;
```

应用层：

- 创建失败 → `UPDATE … state='released'` + 归还 used  
- 所有归还必须幂等（`release_allocation(id)` 多次调用安全）

**禁止**：先启动容器，再 `UPDATE used`。  
**禁止**：用「定时对账 free -h」作为唯一真相（可做巡检，不可做售卖依据）。

---

## 5. 套餐目录

与 PRD 对齐，并增加磁盘与架构：

| 套餐 | CPU | 内存 | 磁盘 | 默认 arch |
|------|-----|------|------|-----------|
| nano | 500m | 256Mi | 5Gi | any（能放下的节点） |
| small | 1 | 512Mi | 10Gi | any |
| medium | 2 | 1Gi | 15Gi | 用户选 |
| large | 4 | 2Gi | 20Gi | 用户选；phone1 常拒 |
| xlarge | 6 | 3Gi | 30Gi | 倾向 amd64-mains |

控制台可提供 `large-amd64` / `large-arm64` 以免选错。校验：规格必须 ≤ 目标节点 allocatable。

自定义套餐：admin 可加；必须 ≤ 某单节点 allocatable 或显式允许「可拆分」（P1 不做拆分到多节点的单一 Workspace）。

---

## 6. 项目预算 vs 集群池

两层都要过：

```
用户请求套餐
  → 检查 project.budget_remaining >= plan   （若项目设置了预算）
  → 检查 cluster/node free >= plan
  → 双扣减（项目已用 + 节点已用）
```

项目预算默认 = 创建时选的「项目总包」；也可「无项目预算、只受集群池限制」。

协作多人共享同一项目预算，见 [04](04-collaboration.md)。

---

## 7. 与 k8s ResourceQuota 的关系

| 层 | 作用 |
|----|------|
| Ledger | **售卖真相**；防控制台超卖；跨 Incus/k8s |
| ResourceQuota | k8s ns 内二次保险；防 kubectl 直接超支 |

流程：Ledger 成功后，若启用 k8s 模式，再 apply Quota=该 Allocation（或项目聚合值）。  
仅 apply Quota **不**算完成占用。

---

## 8. 对账与巡检

定时任务（如每 5 分钟）：

1. `sum(allocations active|reserved) by node` vs `node_capacity.used_*`  
2. Incus 实例列表 vs Workspace 表  
3. 孤儿实例 → 告警；孤儿占用 → 告警  

发现漂移：以账本为准收敛或人工工单；**自动删用户盘**需二次确认。

---

## 9. 管理员强制释放

`platform_admin` 可强制 `released`：

1. 标记 Workspace destroying  
2. 销毁运行时  
3. 释放账本  
4. 重审计 `force_release`

用于节点坏盘、用户失联占坑。

---

## 10. API（账本相关）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/capacity` | admin：池与节点 |
| GET | `/projects/{id}/usage` | 已用/预算 |
| POST | `/projects/{id}/workspaces` | 内部先 Reserve |
| POST | `/allocations/{id}/release` | 正常/补偿 |

错误：`409 INSUFFICIENT_CAPACITY`，body 含 `remaining` 与 `requested`。

---

## 11. 容量规划示例

假设仅 ginkgo+vince 在线：

- 可售内存 ~ 3.0 + 2.7 = 5.7 Gi  
- 已售 2 × large(2Gi) = 4Gi → 剩余 1.7Gi  
- 再申请 large(2Gi) → **拒绝**  
- 可申请 small(512Mi) → 成功落到剩余更大的节点  

phone1 离线时：不得把占用「假装」还在 phone1 上卖第二次；`node_lost` 的 Allocation 仍占全局，直到用户释放或 admin 强制释放后重调度。

---

## 12. 验收（必须自动化）

1. 池剩余 &lt; 请求时，API 返回 409，且无新容器。  
2. 并发 20 个相同创建请求，成功数 × 规格 ≤ 初始 free。  
3. 创建失败后 used 回到原值。  
4. 销毁后可再次买到同等规格。  
5. stopped 默认仍占额；第三用户不能买走这块。  
6. 超售模式关闭时，used 之和 ≤ allocatable 之和。

下一篇：[08-ha-deployment.md](08-ha-deployment.md)
