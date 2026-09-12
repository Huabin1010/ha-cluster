CREATE TABLE IF NOT EXISTS tls_certs (
	id UUID PRIMARY KEY,
	name TEXT NOT NULL,
	names_json TEXT NOT NULL,
	zone_id UUID REFERENCES ingress_domain_zones(id) ON DELETE SET NULL,
	auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
	status TEXT NOT NULL DEFAULT 'pending',
	not_before TIMESTAMPTZ,
	not_after TIMESTAMPTZ,
	issuer TEXT NOT NULL DEFAULT '',
	cert_pem TEXT NOT NULL DEFAULT '',
	key_pem TEXT NOT NULL DEFAULT '',
	last_error TEXT NOT NULL DEFAULT '',
	last_issued_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tls_certs_zone_uidx ON tls_certs (zone_id) WHERE zone_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tls_acme_account (
	id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
	directory TEXT NOT NULL DEFAULT '',
	email TEXT NOT NULL DEFAULT '',
	key_pem TEXT NOT NULL DEFAULT '',
	account_url TEXT NOT NULL DEFAULT '',
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
