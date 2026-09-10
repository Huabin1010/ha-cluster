# 28 · 离线 Depot、CDN 与一键加节点脚本

> 上级索引：[00-index.md](00-index.md)  
> 关联：[10-fast-installer.md](10-fast-installer.md)、[12-easytier.md](12-easytier.md)、[22-project-machine-concepts.md](22-project-machine-concepts.md)  
> 凭据：**仅** [credentials.local.md](../credentials.local.md)（不进 Git）  
> 文档性质：**制品发布与一键安装定稿**

---

## 1. 原则

- 加节点 = **一条 curl 命令** + `join` token；不在目标机手工 `apt` / 拉 Docker Hub。
- 体积大的组件放在 **离线 payload**（按 `amd64` / `arm64` 分包）。
- 公网分发走 **S3 兼容 CDN/Depot**；overlay 内仍可用控制面 `10.129.129.1:9090`（LAN 加速）。
- **账号密码不写进仓库**；见 `docs/credentials.local.md`。

---

## 2. CDN / Depot 布局（bucket `typora`）

| 路径（对象前缀） | 内容 |
|------------------|------|
| `ha-cluster/install.sh` | 一键引导脚本（瘦，几 KB） |
| `ha-cluster/ha-setup-linux-amd64` | 静态 `ha-setup` 二进制 |
| `ha-cluster/ha-setup-linux-arm64` | 同上 arm64 |
| `ha-cluster/ha-payload-linux-amd64.tar.zst` | 离线 payload 归档 |
| `ha-cluster/ha-payload-linux-arm64.tar.zst` | 同上 |
| `ha-cluster/payload-linux-amd64/` | 解压后的目录（可选同步，便于按需拉文件） |
| `ha-cluster/payload-linux-arm64/` | 同上 |
| `ha-cluster/VERSIONS.md` | 版本与校验说明 |

**公网根 URL（path-style，示例）：**

```text
https://rustfs.s.ggss.club:50000/typora/ha-cluster/
```

join token 中应带 `depot=` / `depot_public=` 指向该根（见 §4）。

---

## 3. 一键安装（目标机执行）

### 3.1 标准一行命令

```bash
curl -fsSL https://rustfs.s.ggss.club:50000/typora/ha-cluster/install.sh \
  | sudo bash -s join --token 'ha://join/<cluster>/<secret>?et_net=ha-cluster-easytier&et_peer=tcp://110.40.229.62:15010&api=https://<控制台>/api&depot_public=https://rustfs.s.ggss.club:50000/typora/ha-cluster'
```

脚本行为（`packaging/install.sh`）：

1. 识别 `uname -m` → `amd64` / `arm64`
2. 下载 `ha-setup-linux-<arch>`（若本地无）
3. 下载 `ha-payload-linux-<arch>.tar.zst` 并解压到缓存（可用 `HA_PAYLOAD_FILE` 跳过）
4. 执行 `ha-setup join …`：**先 EasyTier，再离线装 k3s agent / Incus / ha-agent**

### 3.2 环境变量（可选）

| 变量 | 说明 |
|------|------|
| `HA_DEPOT_PUBLIC` | 覆盖 CDN 根 URL |
| `HA_PAYLOAD_FILE` | 本地已有 payload 目录，跳过下载 |
| `HA_SETUP_DIR` | 默认 `/var/lib/ha-setup` |

### 3.3 管理端远程推送（仍是一键）

```bash
./ha-setup add-node --host <ip> --user root --role worker
# 远程执行等价于上面的 curl | bash -s join ...
```

---

## 4. join token 与命令配置

生成 token 时写入（与 [12-easytier.md](12-easytier.md) 一致）：

| 参数 | 示例 |
|------|------|
| `et_net` | `ha-cluster-easytier` |
| `et_peer` | `tcp://110.40.229.62:15010` |
| `api` / `api_public` | 控制台 `https://…/api` |
| `depot` | overlay 内 `http://10.129.129.1:9090`（可选） |
| `depot_public` | `https://rustfs.s.ggss.club:50000/typora/ha-cluster` |

优先级：`install.sh` → `ha-setup` 先 **EasyTier 入网**，再从 `depot_public` 拉 payload；overlay 不可达时仍可用公网 CDN。

---

## 5. 发布流程（维护者）

### 5.1 本地构建离线包

```bash
bash packaging/fetch-deps.sh all
bash packaging/pack.sh amd64
bash packaging/pack.sh arm64
# 产出 dist/ha-payload-linux-*.tar.zst 等
```

### 5.2 上传到 RustFS（bucket `typora`）

凭据见 `docs/credentials.local.md` §Depot CDN。

```bash
export HA_DEPOT_S3_ENDPOINT=https://rustfs.s.ggss.club:50000
export HA_DEPOT_S3_BUCKET=typora
export HA_DEPOT_S3_PREFIX=ha-cluster
export HA_DEPOT_S3_ACCESS_KEY=...   # 勿提交 Git
export HA_DEPOT_S3_SECRET_KEY=...
export HA_DEPOT_PUBLIC=https://rustfs.s.ggss.club:50000/typora/ha-cluster

bash packaging/upload-depot-s3.sh
```

依赖：AWS CLI（`bash packaging/upload-depot-s3.sh`）或 **Python + boto3**（Windows 推荐）：

```bash
pip install boto3
# 同上 export 环境变量后
python packaging/upload-depot-s3.py
```

### 5.3 验收

```bash
curl -fsSL https://rustfs.s.ggss.club:50000/typora/ha-cluster/install.sh | head
curl -fsSL https://rustfs.s.ggss.club:50000/typora/ha-cluster/payload-linux-amd64/manifest.json | head
```

在测试 VM 上跑完整 `join`；控制台节点列表出现 Ready + 正确 `fabric_ip`。

---

## 6. 与控制面关系

| 场景 | Depot 来源 |
|------|------------|
| 手机 / 4G 新节点 | **CDN** `depot_public` |
| 同 LAN / overlay 已通 | 控制面 `10.129.129.1:9090`（更快） |
| 完全离线 | U 盘拷贝 `ha-node-linux-<arch>.run` 胖包（见 [10](10-fast-installer.md)） |

用户 **Workspace** 仍由审批后平台 Launch；本节仅 **纳管宿主机 Node**。

---

## 7. 安全

- RustFS 账号仅维护者持有；**禁止**写入 README / PRD / 已跟踪的 `.md`。
- CDN 桶建议 **只读** 公开策略或预签名；写权限仅 CI/管理员。
- `install.sh` 与 payload 发布时附带 `SHA256SUMS` 校验（`pack.sh` 已生成）。

---

## 8. 验收清单

- [ ] `install.sh` 可从 CDN 拉取且可执行  
- [ ] arm64 / amd64 各测一台一键 join 成功  
- [ ] 未配置 overlay 时仅靠 `depot_public` 可装完  
- [ ] 凭据仅存在于 `credentials.local.md`  
- [ ] join token 文档/控制台生成的命令含正确 `depot_public`  
