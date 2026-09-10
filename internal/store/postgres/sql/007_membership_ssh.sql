ALTER TABLE memberships ADD COLUMN IF NOT EXISTS ssh_access TEXT NOT NULL DEFAULT 'none';
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS ssh_mode TEXT NOT NULL DEFAULT 'read_write';

UPDATE memberships SET ssh_access = 'granted', ssh_mode = 'read_write'
  WHERE role IN ('owner', 'admin');

UPDATE memberships SET ssh_access = 'none'
  WHERE role IN ('developer', 'viewer') AND ssh_access = 'none';
