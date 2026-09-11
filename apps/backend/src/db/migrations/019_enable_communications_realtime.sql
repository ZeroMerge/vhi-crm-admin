-- Enable secure Supabase Realtime delivery for communication changes.
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
END
$$;
