-- Allow the same public key fingerprint on multiple platform users
-- (e.g. one laptop key for chenweipeng + yexinwei).
ALTER TABLE ssh_keys DROP CONSTRAINT IF EXISTS ssh_keys_fingerprint_key;
CREATE UNIQUE INDEX IF NOT EXISTS ssh_keys_user_fingerprint_uidx
  ON ssh_keys (user_id, fingerprint);
