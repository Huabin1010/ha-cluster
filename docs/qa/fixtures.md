# QA Fixtures（Q2 维护）

本地默认 API：`http://127.0.0.1:8080`

种子管理员（`HA_SEED=1`）：`admin` / `adminadmin`（上线后必改）。

建议手工注册：

| 用户名 | 密码 | 用途 |
|--------|------|------|
| qa_owner | password1 | 项目 owner |
| qa_dev | password1 | developer |
| qa_viewer | password1 | viewer |

```bash
curl -s -X POST http://127.0.0.1:8080/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"qa_owner","email":"qa_owner@example.com","password":"password1"}'
```

登录取 token：

```bash
curl -s -X POST http://127.0.0.1:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"qa_owner","password":"password1"}'
```
