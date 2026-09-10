# 32 · 真机闭环检查清单（T2–T5）

> 上级：[13-remaining-tasks.md](13-remaining-tasks.md) · Fabric：[easytier-fabric.mdc](../../.cursor/rules/easytier-fabric.mdc)

## T2 · EasyTier Hub

- [ ] 安全组放行 UDP/TCP `15010`
- [ ] `/etc/ha-cluster/easytier.env` 使用 `10.129.129.1/24`、`ha-cluster-easytier`
- [ ] 试连机 `ping 10.129.129.1`

## T3 · Depot

```bash
bash packaging/fetch-deps.sh all
bash packaging/pack.sh amd64 && bash packaging/pack.sh arm64
python packaging/upload-depot-s3.py
```

- [ ] `curl -fsSL …/install.sh` 可访问

## T4 · Worker

- [ ] 控制台 Nodes → 生成 join token（`platform_admin`）
- [ ] PVE VM 执行 join；Nodes Ready
- [ ] 创建 Workspace → `running`

## T5 · Bastion SSH

- [ ] 用户登记 SSH 公钥
- [ ] `ssh_access=granted` 后可 `ssh user@bastion:8099 -t <workspace-id>`
- [ ] 销毁双层审批 UI + 平台待审页可用
