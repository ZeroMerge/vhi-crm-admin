-- In-app notifications (Phase 1). Plain Postgres only: no Supabase objects.
-- One row per recipient. Exactly one of admin_id / customer_id is set.
-- title/body are rendered when the event is emitted; they are what the recipient sees.

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    UUID REFERENCES admins(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  module      TEXT,                      -- admin rows: the module that gates visibility
  entity_type TEXT NOT NULL,             -- 'shipment' | 'customer_thread'
  entity_id   UUID NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- non-sensitive only
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('admin', 'customer', 'system')),
  actor_id    UUID,                      -- admin or customer id; no FK on purpose
  dedupe_key  TEXT NOT NULL,             -- `${type}:${sourceRowId}`
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_one_recipient CHECK ((admin_id IS NULL) <> (customer_id IS NULL)),
  CONSTRAINT notifications_admin_has_module CHECK (admin_id IS NULL OR module IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_admin_dedupe_uq
  ON notifications (admin_id, dedupe_key) WHERE admin_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_customer_dedupe_uq
  ON notifications (customer_id, dedupe_key) WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_admin_feed_idx
  ON notifications (admin_id, id DESC) WHERE admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_customer_feed_idx
  ON notifications (customer_id, id DESC) WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_admin_unread_idx
  ON notifications (admin_id, module) WHERE admin_id IS NOT NULL AND read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_customer_unread_idx
  ON notifications (customer_id) WHERE customer_id IS NOT NULL AND read_at IS NULL;
