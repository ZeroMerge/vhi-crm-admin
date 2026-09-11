-- Authorize private Realtime channels in addition to communications row access.
DO $$
BEGIN
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
END
$$;
