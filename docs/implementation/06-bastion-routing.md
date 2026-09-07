# 06 · 跳板机路由（Bastion）

> 上级：[00-index.md](00-index.md)  
> SSH 环境：[05-ssh-isolation.md](05-ssh-isolation.md)

---

## 1. 为什么必须有跳板

| 现状 | 风险 |
|------|------|
| 各手机 NPS 映射 8089/8092/8095… | 端口即拓扑泄露；难做统一身份 |
| 用户直连 worker | ACL、审计、协作权限无法集中 |
| 手机 IP / 隧道变化 | 用户配置常坏 |

**原则：用户只认识 Bastion；Workspace 坐标只有控制面知道。**

管理员紧急通道可保留直连 NPS，但与产品用户通道分离。

---

## 2. 逻辑位置

```
Internet
   │
   ▼
VPS: bastion.mnnumath.vip:22 (或 :8099)
   │  认证（公钥 / Teleport 证书）
   │  授权（项目角色）
   │  路由（workspace_id → 当前后端）
   ▼
EasyTier 10.88.0.x:workspace-ssh
   ▼
incus nic → workspace:22
```

Bastion 与 `ha-api`、**EasyTier 中枢**同属控制面主机（一期）。NPS 紧急 SSH 与产品通道分离。

---

## 3. 选型落地

### 3.1 MVP：OpenSSH + `ha-bastion-proxy`

**sshd_config 要点：**

```
AuthorizedKeysCommand /usr/local/bin/ha-auth-keys %u
AuthorizedKeysCommandUser nobody
ForceCommand /usr/local/bin/ha-bastion-proxy
PermitTTY yes
X11Forwarding no
AllowTcpForwarding no
PermitTunnel no
```

**`ha-auth-keys`：** 查 `ha-api`（本地 unix socket 或本机 HTTPS）返回该用户有效公钥行。

**`ha-bastion-proxy`：**

1. 读环境 / SSH_ORIGINAL_COMMAND；
2. 解析目标：`ssh bastion` 交互菜单，或 `ssh bastion ws-xxxx`，或 `ssh alice-ws-xxxx@bastion`；
3. 调 API：`GET /me/workspaces/{id}/ssh-target`（鉴权：成员且 developer+）；
4. `ssh`/Dial 到返回的 **EasyTier 地址** `10.88.0.x:<ws_ssh_port>`；
5. 写 audit：session_id, user, workspace, start/end。

### 3.2 标准期：Teleport OSS

- 节点（或 agent）加入 Teleport；
- RBAC：`logins` + `workspace` labels；
- 录制会话到 VPS 存储；
- 短时证书，免长期散落公钥。

迁移路径：MVP 公钥模型 → 导出到 Teleport；用户文档切换 hostname 即可。

---

## 4. 路由表

控制面维护：

```
workspace_id → {
  node_id,
  backend: "10.88.0.x:<port>",   # 节点 EasyTier IP + workspace ssh 口
  status: running|stopped|lost,
  fingerprint: host_key_sha256
}
```

`ha-agent` 上报：`fabric_ip`、`lan_ip`、可选 `breakglass_ssh`。Bastion 拨号顺序：**EasyTier → LAN → NPS 破窗**。详见 [12](12-easytier.md) §3.3。

---

## 5. 用户侧用法

### 5.1 交互选择

```bash
ssh alice@bastion.mnnumath.vip
# 列出可访问 Workspace → 输入序号
```

### 5.2 直达

```bash
ssh alice@bastion.mnnumath.vip -t ws-0a1b2c
# 或
ssh ws-0a1b2c@bastion.mnnumath.vip   # 若用多账号映射
```

### 5.3 SSH config 片段（控制台一键下载）

```sshconfig
Host ha-ws-0a1b2c
  HostName bastion.mnnumath.vip
  User alice
  Port 8099
  ForwardAgent yes
  IdentityFile ~/.ssh/id_ed25519
  RequestTTY force
  RemoteCommand <workspace-uuid>
```

> vps-1 管理 SSH 占用 `:22`，产品 Bastion 固定 **8099**（见 inventory）。

（具体以 `ForceCommand` 实现为准；Teleport 则用 `tsh ssh`。）

---

## 6. ACL 规则

```
allow ssh to workspace W iff
  user.active
  AND membership(project(W)) in {owner, admin, developer}
  AND (W.visibility == shared OR W.owner == user OR role in {owner, admin})
  AND W.status in {running}
```

`viewer` 默认拒绝 SSH。  
`stopped`：提示先到控制台开机。  
`node_lost`：拒绝并提示重建。

---

## 7. 主机密钥与 MitM

- 每 Workspace 首次生成 ssh_host_*; 指纹存 DB。
- Bastion 对后端使用 `known_hosts` 钉扎；变化则告警并阻断（防节点被重装劫持）。
- 用户只验证 **Bastion** 主机密钥（控制台展示指纹）。

---

## 8. 会话审计

| 字段 | 说明 |
|------|------|
| session_id | UUID |
| user_id / username | |
| workspace_id | |
| client_ip | |
| started_at / ended_at | |
| auth_method | pubkey / cert |
| outcome | success / deny / error |

P2：`script` / Teleport recording 存对象存储；默认仅元数据，因手机磁盘与隐私。

---

## 9. 高可用与故障

| 故障 | 影响 | 缓解 |
|------|------|------|
| Bastion 进程挂 | 全员无法 SSH | systemd 守护；二期双机 + DNS |
| EasyTier 到该节点中断 | 该 Workspace SSH 主路径失败 | 试 LAN/破窗；状态 `fabric_degraded`；**不删实例** |
| ha-api 挂 | 新会话鉴权失败 | 可缓存短时 ACL（慎用）或 Bastion 只读副本 |
| 整台 VPS 挂 | SSH+API 全挂 | 见 [08](08-ha-deployment.md) |

---

## 10. 安全细则

- Bastion 用户 shell 为 `nologin` + ForceCommand，禁止落地 VPS 任意命令。
- 禁止用户从 Bastion `ssh` 到其他内网主机（代理白名单只有 workspace backends）。
- 速率限制：每用户并发会话上限（如 5）。
- 失败登录写入审计并告警暴力破解。
- 与 OpenResty 证书体系分离；SSH 可用独立 ed25519 主机密钥。

---

## 11. 端口与域名建议

| 项 | 值 |
|----|-----|
| DNS | `bastion.mnnumath.vip` → VPS |
| 端口 | **8099**（`:22` 留给管理 SSH；安全组放行 8099，勿动 8088–8097） |
| 管理 | Bastion 指标仅本机；独立 `sshd -f /etc/ssh/sshd_config_bastion` |

详见 [12-easytier.md](12-easytier.md)。

---

## 12. MVP 验收

1. 未登记公钥无法登录 Bastion。  
2. 非项目成员无法进入该项目 Workspace。  
3. 成员可直达 `ws-xxx`（经 EasyTier，不经 npc）。  
4. 会话开始/结束有审计行。  
5. 不新增 NPS 端口；worker 无公网 SSH。

下一篇：[07-resource-ledger.md](07-resource-ledger.md)
