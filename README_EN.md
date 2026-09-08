# ha-cluster

[English](README_EN.md) | [简体中文](README.md)

[![CI](https://github.com/Huabin1010/ha-cluster/actions/workflows/ci.yml/badge.svg)](https://github.com/Huabin1010/ha-cluster/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.24+-00ADD8?logo=go)](https://golang.org/)
[![Node Version](https://img.shields.io/badge/Node-20+-339933?logo=node.js)](https://nodejs.org/)

**ha-cluster** is a lightweight, highly available distributed container scheduling and workspace management platform designed for edge computing, personal computing clusters, and heterogeneous devices. It bridges devices that cannot sit in the same rack—such as x86 desktop PCs, Linux-flashed ARM phones, SBCs, and cloud VPS instances—into a unified compute fabric with a single public ingress, zero-oversell hard resource ledgers, isolated SSH access, and high resilience against node churn.

---

## Key Features

- 🌐 **Heterogeneous Mesh Fabric (EasyTier)**: Nodes across different NATs, home broadband, 4G/5G mobile carriers, or cloud networks seamlessly interconnect via EasyTier mesh overlay. Nodes can dynamically join, sleep, or leave without breaking the control plane.
- 📊 **Hard Resource Ledger (Strict No-Oversell)**: Hard allocations prevent node oversubscription. Eliminates cascading OOM crashes on low-memory ARM worker nodes.
- 🖥️ **Native-Feel Workspace & Bastion SSH**: Built on Incus container runtimes and an integrated dynamic SSH Bastion proxy. Developers can access isolated container workspaces using their own SSH keys with zero configuration friction.
- 👥 **Multi-Tenant Collaboration (RBAC)**: Role-based access control (Owner, Developer, Viewer) with invite tokens, per-project quota slices, and structured audit logs.
- 🛠️ **Zero-Friction Node Setup**: Automated node onboarding via `ha-setup` and offline packaging bundles (Depot), orchestrating systemd unit generation, overlay setup, and agent registration.
- 🎨 **Modern Web Console**: Responsive dashboard built with React 18, Refine, and TailwindCSS for managing workspaces, node capacity, SSH keys, and audit history across desktop and mobile browsers.

---

## Architecture

```
                     ┌──────────────────────────────────────────────┐
                     │          Public Gateway / Control (VPS)      │
                     │  - OpenResty / SSL (:443)                    │
                     │  - ha-api (Go Control Plane)                 │
                     │  - Bastion SSH Proxy (:2222)                 │
                     │  - EasyTier Hub (:11010, 10.88.0.1)          │
                     └──────────────────────┬───────────────────────┘
                                            │
                                 EasyTier Private Overlay Mesh
                                            │
         ┌──────────────────────────────────┼──────────────────────────────────┐
         ▼                                  ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐                ┌─────────────────┐
│ x86 Workstation │                │  Linux Phone A  │                │  Linux Phone B  │
│ - ha-agent      │                │  (ARM64 worker) │                │  (ARM64 worker) │
│ - Incus Runtime │                │ - ha-agent      │                │ - ha-agent      │
│ - ~29G alloc.   │                │ - Incus Runtime │                │ - Incus Runtime │
└─────────────────┘                └─────────────────┘                └─────────────────┘
```

---

## Components

| Component | Path | Description |
|-----------|------|-------------|
| **ha-api** | `cmd/ha-api/` | Central control plane service exposing REST APIs, ledger deductions, JWT auth, and audit streams |
| **ha-agent** | `cmd/ha-agent/` | Worker daemon reporting host CPU/memory capacities and periodic heartbeats |
| **ha-setup** | `cmd/ha-setup/` | Node bootstrapping tool handling overlay pairing, systemd orchestration, and initialization |
| **hactl** | `cmd/hactl/` | Cluster operations CLI |
| **ha-bastion-proxy** | `cmd/ha-bastion-proxy/` | SSH gateway verifying user keys and routing sessions directly to target containers |
| **web** | `web/` | Responsive frontend console built with Refine and React |

---

## Quick Start

### Prerequisites

- **Go**: 1.24+
- **Bun** (recommended for `bun install` / `bun dev`) or **Node.js** 20.x+ (with npm)
- **Docker & Docker Compose** (Optional, for running with PostgreSQL)

### 1. Run Locally (In-Memory Ledger Mode)

```bash
# Start API hot reload + web together (Windows / macOS / Linux)
bun install
bun dev
```

Or start them in separate terminals:

```bash
# Start backend API (uses in-memory store by default)
go run ./cmd/ha-api

# In another terminal, start the web console
cd web
npm install
npm run dev
```

Open `http://localhost:5173` to access the console.

### 2. Run with Docker Compose (PostgreSQL Persistence)

```bash
docker compose up --build -d
```

### 3. Build All Binaries

```bash
make build
```
Compiled binaries will be generated in `bin/`:
- `bin/ha-api`
- `bin/ha-agent`
- `bin/ha-setup`
- `bin/hactl`
- `bin/ha-bastion-proxy`

---

## Testing

Run tests across both backend and frontend suites:

```bash
# Run all unit tests
make test

# Backend tests only
make test-go

# Frontend tests only
make test-web
```

---

## Documentation

Comprehensive design docs and operational runbooks are located in `docs/`:

- 📋 [Product Requirements Document (PRD)](docs/prd.md): Background, phases, constraints, and non-goals
- 📑 [Implementation Specifications Index](docs/implementation/00-index.md)
  - [01 Technical Selection](docs/implementation/01-tech-selection.md)
  - [02 Architecture & Component Topology](docs/implementation/02-architecture.md)
  - [03 User Management & RBAC](docs/implementation/03-user-management.md)
  - [04 Collaboration & Workspaces](docs/implementation/04-collaboration.md)
  - [05 Isolated SSH & User Experience](docs/implementation/05-ssh-isolation.md)
  - [06 Bastion Routing & ACL](docs/implementation/06-bastion-routing.md)
  - [07 Resource Ledger & Hard Limits](docs/implementation/07-resource-ledger.md)
  - [08 High Availability & Disaster Recovery](docs/implementation/08-ha-deployment.md)
  - [10 Fast Installer Specification](docs/implementation/10-fast-installer.md)
  - [12 EasyTier Mesh Fabric Integration](docs/implementation/12-easytier.md)
- 🖥️ [Hardware Device Inventory](docs/inventory.md)
- 🔑 [Credentials Template](docs/credentials.example.md)

---

## Contributing

Contributions are welcome! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

This project is licensed under the [MIT License](LICENSE).
