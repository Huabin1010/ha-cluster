-- Node business type (cloud/self/customer), admin remark and tags
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS machine_type TEXT NOT NULL DEFAULT 'self';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS remark TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
