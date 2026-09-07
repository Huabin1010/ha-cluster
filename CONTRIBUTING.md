# Contributing to ha-cluster

感谢关注与参与 `ha-cluster` 项目！我们欢迎各种形式的贡献，包括但不限于报告 Bug、提出新功能建议、完善文档以及提交代码。

## 开发工作流

1. **Fork 本仓库** 到个人 GitHub 账号。
2. **克隆代码并创建分支**：
   ```bash
   git clone https://github.com/<your-username>/ha-cluster.git
   cd ha-cluster
   git checkout -b feature/your-feature-name
   ```
3. **环境依赖**：
   - Go 1.24+
   - Node.js 20+
   - Docker / Docker Compose（可选）
   - Incus（真机环境测试可选）
4. **运行测试**：
   在提交前请务必保证所有测试通过：
   ```bash
   make test
   ```
5. **代码提交规范**：
   - 提交信息建议清晰表达修改目的（如 `feat: add node drain command`、`fix: handle bastion connection timeout`）。
   - 严禁将任何生产凭证、私钥或真实敏感配置提交到仓库。
6. **创建 Pull Request**：
   - 确保分支 rebase 到最新的 `main` 分支。
   - 描述 PR 解决的问题及测试验证步骤。

## 报告问题

如果发现任何 Bug 或有功能建议，请在 GitHub Issues 中提交，并附上：
- 运行环境（操作系统、架构、Go/Node 版本）
- 重现步骤与预期行为
- 相关的错误日志或截图
