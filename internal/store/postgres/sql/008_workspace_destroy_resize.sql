-- Workspace destroy intermediate states and resize kind (documented in 31-framework-layers.md)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS resize_kind TEXT NOT NULL DEFAULT '';
