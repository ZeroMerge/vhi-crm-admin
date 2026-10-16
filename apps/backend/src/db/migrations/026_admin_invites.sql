-- Phase 4: admin invitations (replace the temporary password). The token itself is never stored, only its SHA-256.
-- An invited admin's admins.password_hash is the sentinel '!invite-pending' (not a bcrypt hash, so it can never match).

CREATE TABLE IF NOT EXISTS admin_invites (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash  BYTEA NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,                -- created_at + 72h
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,                         -- set when a resend replaces it
  created_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one open invite per admin.
CREATE UNIQUE INDEX IF NOT EXISTS admin_invites_one_open ON admin_invites (admin_id) WHERE used_at IS NULL AND revoked_at IS NULL;
