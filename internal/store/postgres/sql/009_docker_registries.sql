CREATE TABLE IF NOT EXISTS docker_registries (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    server TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL DEFAULT '',
    password_enc TEXT NOT NULL DEFAULT '',
    auto_inject BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_docker_registries_auto_inject ON docker_registries (auto_inject) WHERE auto_inject = TRUE;
