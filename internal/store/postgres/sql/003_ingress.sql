CREATE TABLE IF NOT EXISTS ingress_routes (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  domain TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '/',
  port INT NOT NULL,
  preset TEXT NOT NULL DEFAULT 'nocache',
  extra_nginx TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingress_domain ON ingress_routes (lower(domain));
CREATE INDEX IF NOT EXISTS idx_ingress_workspace_id ON ingress_routes (workspace_id);
