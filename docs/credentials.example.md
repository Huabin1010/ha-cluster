# 凭据模板

复制为 `credentials.local.md` 后填实值。`credentials.local.md` 已在 `.gitignore`。

```markdown
# 本机凭据 — 勿提交

## 通用
- 开发机 / 多数 SSH：`<password>`

## VPS
- SSH：root / `<password>`
- NPS Web：admin / `<password>`  （http://127.0.0.1:18080）

## NPS vkey
- ginkgo：`<vkey>`
- phone1：`<vkey>`
- vince：`<vkey>`

## 宝塔
- 统一计划账号：huanghuabin / `<password>`
- ginkgo 安装时随机号：用户 `<…>` 密码 `<…>` 端口 33144 入口 /f730fa4d
- phone1：端口 24396 入口 /abaff8a4
- vince：未装完

## EasyTier（T2）
- 网络名：`ha-c1`
- 网络密钥：`<et_secret>`
- 版本：easytier-core 2.6.4
```
