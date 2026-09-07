-- ha-cluster schema
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  platform_role TEXT NOT NULL,
  status TEXT NOT NULL,
  token_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  budget_cpu_milli BIGINT NOT NULL DEFAULT 0,
  budget_mem_bytes BIGINT NOT NULL DEFAULT 0,
  budget_disk_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS nodes (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  arch TEXT NOT NULL,
  class TEXT NOT NULL DEFAULT '',
  power TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  fabric_ip TEXT NOT NULL DEFAULT '',
  lan_ip TEXT NOT NULL DEFAULT '',
  breakglass_ssh TEXT NOT NULL DEFAULT '',
  allocatable_cpu_milli BIGINT NOT NULL,
  allocatable_mem_bytes BIGINT NOT NULL,
  allocatable_disk_bytes BIGINT NOT NULL,
  used_cpu_milli BIGINT NOT NULL DEFAULT 0,
  used_mem_bytes BIGINT NOT NULL DEFAULT 0,
  used_disk_bytes BIGINT NOT NULL DEFAULT 0,
  fabric_path TEXT NOT NULL DEFAULT '',
  fabric_rtt_ms BIGINT NOT NULL DEFAULT 0,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS allocations (
  id UUID PRIMARY KEY,
  workspace_id UUID,
  project_id UUID NOT NULL,
  node_id UUID NOT NULL REFERENCES nodes(id),
  cpu_milli BIGINT NOT NULL,
  mem_bytes BIGINT NOT NULL,
  disk_bytes BIGINT NOT NULL,
  arch TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  arch TEXT NOT NULL,
  visibility TEXT NOT NULL,
  owner_user_id UUID NOT NULL,
  node_id UUID NOT NULL,
  allocation_id UUID NOT NULL,
  status TEXT NOT NULL,
  ssh_port INT NOT NULL DEFAULT 0,
  host_key_fp TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Indexes and constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_project_name ON workspaces (project_id, name) WHERE status <> 'destroyed';
CREATE INDEX IF NOT EXISTS idx_allocations_workspace_id ON allocations (workspace_id);
CREATE INDEX IF NOT EXISTS idx_allocations_project_id ON allocations (project_id);
CREATE INDEX IF NOT EXISTS idx_allocations_node_id ON allocations (node_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_project_id ON workspaces (project_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_node_id ON workspaces (node_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON workspaces (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_project_id ON invitations (project_id);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_id ON refresh_sessions (user_id);

