# ha-cluster

[简体中文](README.md) | [English](README_EN.md)

[![CI](https://github.com/Huabin1010/ha-cluster/actions/workflows/ci.yml/badge.svg)](https://github.com/Huabin1010/ha-cluster/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.24+-00ADD8?logo=go)](https://golang.org/)
[![Node Version](https://img.shields.io/badge/Node-20+-339933?logo=node.js)](https://nodejs.org/)

**ha-cluster** 是一个面向边缘计算、家用算力与异构设备的轻量级高可用分布式容器调度与工作区（Workspace）管理平台。它将散落各处、网络互不相通的设备（如 x86 服务器、台式机、刷入 Linux 的 ARM 手机、开发板与云端 VPS）编织为一个具备统一入口、严格资源硬账本、安全隔离 SSH 访问和高可用韧性的算力集群。

---

## 核心特性

- 🌐 **异构设备组网（EasyTier Fabric）**：节点位于 NAT、家庭宽带、移动 4G/5G 或公网环境均可平滑接入，底层通过 EasyTier 建立私有 Mesh Overlay，支持节点按需入网与动态离线。
- 📊 **硬占用资源账本（Hard Resource Ledger）**：严格实行配额预占机制，杜绝超卖。避免物理内存较小的 ARM 手机因超配产生连锁 OOM 崩溃。
- 🖥️ **真机感 Workspace 隔离与跳板路由**：基于 Incus 容器轻量切片，集成动态 Bastion SSH 跳板网关。用户在浏览器或终端中使用专属密钥无缝直连 Workspace，体验与真实物理机一致。
- 👥 **多租户与团队协作（RBAC）**：支持 Owner、Developer、Viewer 角色划分与邮件/Token 邀请加入机制，项目级配额软切分与实时审计日志追踪。
- 🛠️ **一键极速加网（Zero-Friction Joining）**：提供 `ha-setup` 自动化部署套件与统一 Depot 离线制成品，一键完成节点检测、虚网配对与 Agent 服务托管。
- 🎨 **现代化管控控制台**：基于 React 18 + Refine + TailwindCSS 构建响应式管理面板，包含工作区管理、节点拓扑、容量仪表盘、SSH 公钥管理与审计面板。

---

## 架构概览

```
                     ┌──────────────────────────────────────────────┐
                     │            公网入口 / 控制面 (VPS)           │
                     │  - OpenResty / SSL (:443)                    │
                     │  - ha-api (Go 控制核心)                      │
                     │  - Bastion SSH Proxy (:2222)                 │
                     │  - EasyTier Hub (:11010, 10.88.0.1)          │
                     └──────────────────────┬───────────────────────┘
                                            │
                                 EasyTier 虚拟私有网 (Overlay)
                                            │
         ┌──────────────────────────────────┼──────────────────────────────────┐
         ▼                                  ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐                ┌─────────────────┐
│ x86 开发机/服务器│                │   Linux 手机 A  │                │   Linux 手机 B  │
│ - ha-agent      │                │   (ARM64 worker)│                │   (ARM64 worker)│
│ - Incus 容器运行时│                │ - ha-agent      │                │ - ha-agent      │
│ - 可售内存 ~29G  │                │ - Incus 容器     │                │ - Incus 容器     │
└─────────────────┘                └─────────────────┘                └─────────────────┘
```

---

## 组件构成

| 组件 | 路径 | 说明 |
|------|------|------|
| **ha-api** | `cmd/ha-api/` | 集群核心管控服务，提供 RESTful API、资源账本扣减、JWT 鉴权与审计流 |
| **ha-agent** | `cmd/ha-agent/` | 节点守护进程，周期上报 CPU/内存物理与可售水位，提供状态心跳 |
| **ha-setup** | `cmd/ha-setup/` | 节点快速接入工具，负责自动探测网络拓扑、分发 systemd 单元与初始化 |
| **hactl** | `cmd/hactl/` | 集群 CLI 命令行运维工具 |
| **ha-bastion-proxy** | `cmd/ha-bastion-proxy/` | 隔离跳板 SSH 路由网关，负责身份验证并动态接入目标 Workspace 容器 |
| **web** | `web/` | 基于 Refine 的管理前端，支持响应式移动端/桌面端交互 |

---

## 快速开始

### 依赖环境

- **Go**：1.24 或更高版本
- **Bun**（推荐，用于 `bun install` / `bun dev`）或 **Node.js** 20.x+（搭配 npm）
- **Docker & Docker Compose**（可选，用于一键启动后端与数据库）

### 1. 本地快速运行（内存账本模式）

```bash
# 同时启动 API 热重载 + 前端（Windows / macOS / Linux）
bun install
bun dev
```

也可分终端启动：

```bash
# 启动 API 服务（默认内存数据存储）
go run ./cmd/ha-api

# 新终端启动前端控制台
cd web
npm install
npm run dev
```

浏览器访问 `http://localhost:5173` 即可进入控制台。初始管理账号通过接口自动初始化。

### 2. 使用 Docker Compose 本地全栈（推荐）

Postgres + ha-api + Vite 控制台 + 模拟三台 worker 心跳：

```bash
# Windows
powershell -File docker/dev/up.ps1

# macOS / Linux
bash docker/dev/up.sh

# 或仓库根目录
docker compose up -d
```

- 控制台：<http://localhost:5173>
- API：<http://localhost:8080>
- 管理员：`admin` / `adminadmin`
- 数据库管理（Adminer）：<http://localhost:8081>

集成测试：

```bash
cd docker/dev
docker compose --profile test run --rm test-integration
docker compose --profile test run --rm test-workflow
```

### 3. 构建全部二进制组件

```bash
make build
```
编译生成的二进制工具将放置在 `bin/` 目录下：
- `bin/ha-api`
- `bin/ha-agent`
- `bin/ha-setup`
- `bin/hactl`
- `bin/ha-bastion-proxy`

---

## 自动化测试

项目拥有严格的单元测试与端到端测试覆盖：

```bash
# 运行后端与前端测试
make test

# 单独执行 Go 测试
make test-go

# 单独执行前端测试
make test-web
```

---

## 文档索引

详细的设计文档与使用手册请查阅 `docs/` 目录：

- 📋 [产品需求文档 (PRD)](docs/prd.md)：业务背景、演进阶段、硬性约束与红线
- 📑 [技术落地实施指南总览](docs/implementation/00-index.md)
  - [01 技术选型与决策](docs/implementation/01-tech-selection.md)
  - [02 核心系统架构](docs/implementation/02-architecture.md)
  - [03 用户系统与权限控制 (RBAC)](docs/implementation/03-user-management.md)
  - [04 项目协作与 Workspace 生命周期](docs/implementation/04-collaboration.md)
  - [05 隔离 SSH 与真机体验实现](docs/implementation/05-ssh-isolation.md)
  - [06 Bastion 跳板机路由设计](docs/implementation/06-bastion-routing.md)
  - [07 资源账本与硬占用规范](docs/implementation/07-resource-ledger.md)
  - [08 高可用部署与灾备恢复](docs/implementation/08-ha-deployment.md)
  - [10 快速加网安装器规范](docs/implementation/10-fast-installer.md)
  - [12 EasyTier 组网底盘设计](docs/implementation/12-easytier.md)
- 🖥️ [设备硬件台账 (Inventory)](docs/inventory.md)
- 🔑 [凭据配置模板](docs/credentials.example.md)

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！参与贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [行为准则](CODE_OF_CONDUCT.md)。

---

## 开源协议

本项目采用 [MIT License](LICENSE) 许可协议。
