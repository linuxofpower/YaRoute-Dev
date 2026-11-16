-- NYX shallow index V1: explicitly opted-in public tenant roots only.
-- Apply to an isolated Neon development branch first, then reviewed release.
-- No provider file contents, access/refresh tokens, or credentials are stored here.
CREATE TABLE IF NOT EXISTS nyx_tenant_index_jobs_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 7 AND 512 AND owner_id LIKE 'oauth:%'),
  connection_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google-drive','mega')),
  root_id text NOT NULL CHECK (length(root_id) BETWEEN 1 AND 256),
  mode text NOT NULL DEFAULT 'shallow' CHECK (mode = 'shallow'),
  enabled boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'idle' CHECK
    (state IN ('idle','running','complete','retry','blocked_truncated','revoked')),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_due_at timestamptz NOT NULL DEFAULT now(),
  last_finished_at timestamptz,
  last_error_code text,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, connection_id, root_id, mode)
);
CREATE INDEX IF NOT EXISTS nyx_tenant_index_jobs_due_v1
  ON nyx_tenant_index_jobs_v1 (next_due_at)
  WHERE enabled = true;

-- Paths are encrypted in the application. path_key is a keyed digest,
-- NOT a reusable bearer credential; encryption key stays in Heroku config.
CREATE TABLE IF NOT EXISTS nyx_tenant_index_items_v1 (
  owner_id text NOT NULL,
  connection_id uuid NOT NULL,
  root_id text NOT NULL,
  path_key text NOT NULL CHECK (length(path_key) = 64),
  sealed_path text NOT NULL,
  is_directory boolean NOT NULL,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, connection_id, root_id, path_key)
);
CREATE INDEX IF NOT EXISTS nyx_tenant_index_items_scope_v1
  ON nyx_tenant_index_items_v1(owner_id,connection_id,root_id);
