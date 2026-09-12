CREATE TABLE IF NOT EXISTS ingress_domain_zones (
    id UUID PRIMARY KEY,
    suffix TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    require_approval BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    allow_random BOOLEAN NOT NULL DEFAULT TRUE,
    allow_custom_prefix BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingress_domain_zones_enabled ON ingress_domain_zones (enabled, sort_order);

ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS domain_tier TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS zone_id UUID NULL REFERENCES ingress_domain_zones(id) ON DELETE SET NULL;
ALTER TABLE ingress_routes ADD COLUMN IF NOT EXISTS prefix TEXT NOT NULL DEFAULT '';
