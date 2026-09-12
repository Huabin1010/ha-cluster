CREATE TABLE IF NOT EXISTS agent_tokens (
	id UUID PRIMARY KEY,
	user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
	token TEXT NOT NULL UNIQUE,
	prefix TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_tokens_token_idx ON agent_tokens (token);
