-- Phase 4: scheduler state, shipment status timing, customer verification time, cleanup indexes. Plain Postgres only.

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job              TEXT PRIMARY KEY,
  next_due_at      TIMESTAMPTZ,              -- daily jobs: always set; interval jobs: NULL = run on the next tick
  last_started_at  TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_status      TEXT CHECK (last_status IN ('succeeded', 'failed')),
  last_error       TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
  run_count        BIGINT NOT NULL DEFAULT 0
);

-- Set only by the shipment state machine on a real transition (src/modules/shipments/statusUpdate.ts), incl. corrections.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
-- Backfill: the latest audited transition INTO the current status; else updated_at; else created_at.
UPDATE shipments s
   SET status_changed_at = COALESCE(
         (SELECT MAX(a.created_at) FROM audit_logs a
           WHERE a.resource_type = 'shipment' AND a.resource_id = s.id
             AND (   (a.action = 'UPDATE_SHIPMENT_STATUS' AND a.metadata->>'to' = s.status::text)
                  OR (a.action = 'ADD_TRACKING_UPDATE' AND a.metadata->>'noteOnly' = 'false' AND a.metadata->>'to' = s.status::text)
                  OR (a.action = 'CANCEL_SHIPMENT' AND s.status::text = 'cancelled'))),
         s.updated_at, s.created_at, NOW())
 WHERE s.status_changed_at IS NULL;
ALTER TABLE shipments ALTER COLUMN status_changed_at SET DEFAULT NOW();
ALTER TABLE shipments ALTER COLUMN status_changed_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS shipments_open_status_idx ON shipments (status, status_changed_at)
  WHERE status IN ('pending', 'processing', 'in_transit', 'clearance');

-- When the account became active: email verification (production) or signup when verification is skipped (non-production).
-- No backfill: unknown for existing accounts.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS customers_verified_at_idx ON customers (verified_at) WHERE verified_at IS NOT NULL;

-- Cleanup scans by age.
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at);
CREATE INDEX IF NOT EXISTS email_deliveries_finished_idx ON email_deliveries (created_at) WHERE status IN ('sent', 'failed', 'cancelled');

-- Job lookups: "already alerted?" (stuck/overdue pre-filter) and "digest already queued for this date?" (any status).
CREATE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications (dedupe_key);
CREATE INDEX IF NOT EXISTS email_deliveries_group_key_idx ON email_deliveries (group_key) WHERE group_key IS NOT NULL;
