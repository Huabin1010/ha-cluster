# 26 · 算力节点类型、备注与标签

> 上级索引：[00-index.md](00-index.md)  
> 关联：[11-node-profiles.md](11-node-profiles.md)、[22-project-machine-concepts.md](22-project-machine-concepts.md)  
> 文档性质：**节点纳管分类**（对齐白板 Machine Types + 运维备注）

---

## 1. 三类机器来源（`machine_type`）

对齐白板「Public / Self / Customer」，平台枚举为：

| 值 | 中文 | 典型来源 | 纳管方式 |
|----|------|----------|----------|
| `cloud` | 云服务 | 腾讯云、阿里云、AWS 等 VPS/GPU | `ha-setup join` + 控制台标为 cloud |
| `self` | 自建实验室 | 手机、PC、IDC、树莓派（**默认**） | EasyTier + ha-agent |
| `customer` | 客户主机 | 私有化交付、客户内网边缘 | Agent 出站；合规隔离调度池 |

与 `class`（phone/desktop/server）、`power`（mains/battery）**正交**：`machine_type` 表业务归属，`class`/`power` 表调度画像。

---

## 2. 备注与标签（已纳管节点）

管理员对已加入的 Node 可维护（**心跳不会覆盖**）：

| 字段 | 说明 |
|------|------|
| `remark` | 自由文本备注（机房位置、负责人、用途） |
| `tags` | 字符串数组，如 `gpu`、`lab-a`、`customer-x`（小写，最多 16 个） |

API（待/UI）：`PATCH /nodes/{id}` body `{ machine_type, remark, tags }`，仅 `platform_admin` / `platform_ops`。

存储：`006_node_type_remark_tags.sql`；模型 `models.Node`。

---

## 3. 调度（二期）

可按 `machine_type` / `tags` 过滤 Workspace 落点，例如客户工作区只上 `customer` 节点。P1 仅展示与筛选，不强制策略。
