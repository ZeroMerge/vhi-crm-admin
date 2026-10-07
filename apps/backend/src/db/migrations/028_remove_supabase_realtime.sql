-- Phase 5: the app no longer uses Supabase Realtime (live messages travel on our own notification stream). Removes what 019/021
-- set up for it, where it exists. Idempotent; a no-op on plain PostgreSQL apart from (re)enabling RLS on communications.
--
-- 1. communications policies (019): NOT wrapped. This table belongs to the app; if dropping them fails, 028 must fail.
-- 2. realtime.messages channel policies (021) and 3. the supabase_realtime publication: owned by Supabase roles on a Supabase
--    project. A missing privilege (or object) there only RAISEs a NOTICE and leaves them in place, so the migration still completes.
--    Leftover channel policies on the Supabase TEST project are acceptable (RISKS R-63): with 1 done they grant nothing on our data.
-- 4. RLS stays ENABLED on communications with no policies: the owner (the backend) keeps access, every other role sees nothing
--    (same stance as 027).

DROP POLICY IF EXISTS communications_customer_realtime_select ON communications;
DROP POLICY IF EXISTS communications_admin_realtime_select ON communications;

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    DROP POLICY IF EXISTS communications_admin_channel_select ON realtime.messages;
    DROP POLICY IF EXISTS communications_customer_channel_select ON realtime.messages;
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE '028: realtime.messages channel policies left in place (%: %)', SQLSTATE, SQLERRM;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'communications') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.communications;
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE '028: communications left in the supabase_realtime publication (%: %)', SQLSTATE, SQLERRM;
END
$$;

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;
