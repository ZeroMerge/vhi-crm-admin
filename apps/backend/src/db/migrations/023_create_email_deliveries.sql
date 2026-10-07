-- Transactional email outbox (Phase 3). Rows are written in the caller's transaction and sent by the in-process worker
-- (src/modules/email/worker.ts). Plain Postgres only: no Supabase objects. gen_random_uuid() is built in from Postgres 13.
CREATE TABLE IF NOT EXISTS email_deliveries (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id     BIGINT REFERENCES notifications(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL,                       -- template key, e.g. 'customer.shipment_status'
  to_address          TEXT NOT NULL,
  admin_id            UUID REFERENCES admins(id) ON DELETE SET NULL,
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  params              JSONB NOT NULL DEFAULT '{}'::jsonb,   -- only what the template renders; secrets/bodies wiped when finished
  group_key           TEXT,
  send_after          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts            INT NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at           TIMESTAMPTZ,
  idempotency_key     UUID NOT NULL DEFAULT gen_random_uuid(), -- sent to the provider; the same on every retry of this row
  provider_message_id TEXT,
  last_error          TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 1000), -- also holds the cancel reason
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  -- The support inbox has neither; individual recipients have exactly one.
  CONSTRAINT email_deliveries_single_recipient CHECK (admin_id IS NULL OR customer_id IS NULL)
);

-- Worker: due queued rows.
CREATE INDEX IF NOT EXISTS email_deliveries_due_idx ON email_deliveries (next_attempt_at) WHERE status = 'queued';
-- Grouping: at most one queued row per group key (enqueueEmail upserts into it).
CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_group_queued_uq
  ON email_deliveries (group_key) WHERE status = 'queued' AND group_key IS NOT NULL;
-- Stale-lock recovery.
CREATE INDEX IF NOT EXISTS email_deliveries_sending_idx ON email_deliveries (locked_at) WHERE status = 'sending';

-- Customer email preferences (in-app notifications are always on). Missing keys = defaults in code.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
