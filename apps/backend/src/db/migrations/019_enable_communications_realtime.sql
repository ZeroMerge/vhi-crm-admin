-- Enable secure Supabase Realtime delivery for communication changes.
--
-- GUARDED (Phase 5): the policy part only runs where Supabase's objects exist (the `authenticated` role and auth.uid()), so this file
-- is a no-op on plain PostgreSQL (dev, CI, the VPS). Editing an applied migration is safe here ONLY because src/db/migrate.ts tracks
-- files by NAME in schema_migrations: databases that already ran 019 never run it again; only fresh installs see this version.
-- Supabase Realtime is no longer used by the app (Phase 5); migration 028 removes these policies where they exist.
ALTER TABLE communications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'communications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.communications;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND to_regprocedure('auth.uid()') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'communications_customer_realtime_select') THEN
      CREATE POLICY communications_customer_realtime_select
        ON communications FOR SELECT TO authenticated
        USING ((SELECT auth.uid()) = customer_id
               AND (current_setting('request.jwt.claims', true)::jsonb ->> 'app_role') = 'customer');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'communications_admin_realtime_select') THEN
      CREATE POLICY communications_admin_realtime_select
        ON communications FOR SELECT TO authenticated
        USING ((current_setting('request.jwt.claims', true)::jsonb ->> 'app_role') = 'admin');
    END IF;
  END IF;
END
$$;
