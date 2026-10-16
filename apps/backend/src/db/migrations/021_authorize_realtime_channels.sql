-- Authorize private Realtime channels in addition to communications row access.
--
-- GUARDED (Phase 5): only runs where Supabase's objects exist (the `authenticated` role, realtime.messages and realtime.topic()), so
-- this file is a no-op on plain PostgreSQL (dev, CI, the VPS). Editing an applied migration is safe here ONLY because
-- src/db/migrate.ts tracks files by NAME in schema_migrations: databases that already ran 021 never run it again; only fresh installs
-- see this version. Supabase Realtime is no longer used by the app (Phase 5); migration 028 removes these policies where it can.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND to_regclass('realtime.messages') IS NOT NULL
     AND to_regprocedure('realtime.topic()') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'communications_admin_channel_select') THEN
      CREATE POLICY communications_admin_channel_select
        ON realtime.messages FOR SELECT TO authenticated
        USING (
          realtime.topic() = 'admin-communications'
          AND (current_setting('request.jwt.claims', true)::jsonb ->> 'app_role') = 'admin'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'communications_customer_channel_select') THEN
      CREATE POLICY communications_customer_channel_select
        ON realtime.messages FOR SELECT TO authenticated
        USING (
          realtime.topic() = 'communications:' || (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
          AND (current_setting('request.jwt.claims', true)::jsonb ->> 'app_role') = 'customer'
        );
    END IF;
  END IF;
END
$$;
