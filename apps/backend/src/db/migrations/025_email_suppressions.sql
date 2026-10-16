-- Phase 4: bounce/complaint suppressions and webhook replay protection. Plain Postgres only.

CREATE TABLE IF NOT EXISTS email_suppressions (
  address         TEXT PRIMARY KEY CHECK (address = lower(address)),
  reason          TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint')),   -- a bounce overrides a complaint, never the reverse
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_event_id TEXT
);

-- Processed webhook ids (svix-id), so a replayed delivery is acknowledged but not processed twice. Cleaned up after 30 days.
CREATE TABLE IF NOT EXISTS processed_webhooks (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS processed_webhooks_received_idx ON processed_webhooks (received_at);
