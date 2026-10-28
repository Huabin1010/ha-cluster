-- Custom domains verified by CNAME (no approval, no DNS credentials).
ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS verify_kind TEXT NOT NULL DEFAULT 'none';
ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS dns_checked_at TIMESTAMPTZ NULL;
ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS dns_error TEXT NOT NULL DEFAULT '';
ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS dns_code TEXT NOT NULL DEFAULT '';
ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS tls_status TEXT NOT NULL DEFAULT '';
ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS tls_error TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_ingress_verify_kind ON ingress_routes (verify_kind, status);
