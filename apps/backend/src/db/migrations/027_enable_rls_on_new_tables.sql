-- Row-level security on the tables added in Phases 1–4 (RISKS R-63). Plain Postgres; safe to run more than once.
-- No policies: every role except the table owner (and superusers / BYPASSRLS roles) sees and changes nothing, which is what the
-- Supabase Data API roles (anon, authenticated) must get. Only the backend uses these tables, connecting as their owner.
-- Deliberately NOT "FORCE ROW LEVEL SECURITY": that would apply the (empty) policy set to the owner too and lock the backend out.

ALTER TABLE IF EXISTS notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_deliveries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS scheduled_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS processed_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS admin_invites      ENABLE ROW LEVEL SECURITY;
