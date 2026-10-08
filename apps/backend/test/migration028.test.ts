import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import { dbTest, resetDatabase } from './helpers/db';
import pool from '../src/config/db';

// Migration 028 on an EXISTING Supabase-style database: it removes the communications realtime policies (019), the realtime.messages
// channel policies (021) and communications' membership of the supabase_realtime publication, keeps RLS on communications, is
// idempotent, and completes even where it lacks the rights on Supabase-owned objects (only a NOTICE for those).
// The Supabase-style objects are built here (schemas auth/realtime, the four named policies, the publication), so the test does not
// depend on the test harness's stand-ins. Policies are created TO PUBLIC: 028 drops them by name, whatever role they target.

const MIGRATIONS = path.join(__dirname, '../src/db/migrations');
const sqlOf = (file: string) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
const PROBE_ROLE = 'vhi_rls_probe';
const COMMS_POLICIES = ['communications_admin_realtime_select', 'communications_customer_realtime_select'];
const CHANNEL_POLICIES = ['communications_admin_channel_select', 'communications_customer_channel_select'];

async function supabaseStyle(client: PoolClient) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
    CREATE SCHEMA IF NOT EXISTS realtime;
    CREATE TABLE IF NOT EXISTS realtime.messages (id BIGSERIAL PRIMARY KEY, topic TEXT);
    CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
    DROP POLICY IF EXISTS communications_customer_realtime_select ON communications;
    DROP POLICY IF EXISTS communications_admin_realtime_select ON communications;
    CREATE POLICY communications_customer_realtime_select ON communications FOR SELECT TO PUBLIC USING (true);
    CREATE POLICY communications_admin_realtime_select ON communications FOR SELECT TO PUBLIC USING (true);
    DROP POLICY IF EXISTS communications_admin_channel_select ON realtime.messages;
    DROP POLICY IF EXISTS communications_customer_channel_select ON realtime.messages;
    CREATE POLICY communications_admin_channel_select ON realtime.messages FOR SELECT TO PUBLIC USING (true);
    CREATE POLICY communications_customer_channel_select ON realtime.messages FOR SELECT TO PUBLIC USING (true);
    DROP PUBLICATION IF EXISTS supabase_realtime;
    CREATE PUBLICATION supabase_realtime FOR TABLE communications;
  `);
}

async function state(client: PoolClient) {
  const policies = (await client.query(`SELECT polname FROM pg_policy WHERE polname = ANY($1::text[]) ORDER BY polname`, [[...COMMS_POLICIES, ...CHANNEL_POLICIES]])).rows.map((r) => r.polname);
  const published = (await client.query(`SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'communications'`)).rows[0].n === 1;
  const rls = (await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.communications'::regclass`)).rows[0].relrowsecurity;
  return { policies, published, rls };
}

describe('migration 028 on an existing Supabase-style database', dbTest, () => {
  let client: PoolClient;
  const notices: string[] = [];

  before(async () => {
    await resetDatabase();
    client = await pool.connect();
    client.on('notice', (n) => notices.push(n.message ?? ''));
  });
  beforeEach(() => {
    notices.length = 0;
  });
  after(async () => {
    await client.query('DROP PUBLICATION IF EXISTS supabase_realtime').catch(() => {});
    client.release();
    await pool.end();
  });

  test('028 removes the Supabase realtime policies and publication membership, keeps RLS on, and is idempotent', async () => {
    await client.query('BEGIN');
    try {
      await supabaseStyle(client);
      const before = await state(client);
      assert.deepEqual(before.policies, [...COMMS_POLICIES, ...CHANNEL_POLICIES].sort());
      assert.equal(before.published, true);

      await client.query(sqlOf('028_remove_supabase_realtime.sql'));
      assert.deepEqual(await state(client), { policies: [], published: false, rls: true });
      await client.query(sqlOf('028_remove_supabase_realtime.sql'));
      assert.deepEqual(await state(client), { policies: [], published: false, rls: true }, 'a second run is a no-op');
      assert.deepEqual(notices.filter((n) => n.startsWith('028:')), [], 'no privilege notices when the rights are there');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  test('without rights on the realtime objects 028 still completes: NOTICEs, channel policies and publication left in place', async (t) => {
    const probe = (await client.query(`SELECT pg_has_role(current_user, (SELECT oid FROM pg_roles WHERE rolname = $1), 'MEMBER') AS ok`, [PROBE_ROLE]).catch(() => ({ rows: [{ ok: false }] }))).rows[0].ok;
    if (!probe) return t.skip(`needs role ${PROBE_ROLE} granted to the test user (see test/rls.test.ts)`);
    await client.query('BEGIN');
    try {
      await supabaseStyle(client);
      // Run 028 as a role that OWNS communications (so the unwrapped part works) but neither realtime.messages nor the publication
      // (both stay owned by the test user, which the probe is not a member of): the Supabase situation where 021's objects belong to
      // Supabase's roles.
      await client.query(`GRANT CREATE, USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
      await client.query(`GRANT USAGE ON SCHEMA realtime TO ${PROBE_ROLE}`);
      await client.query(`ALTER TABLE communications OWNER TO ${PROBE_ROLE}`);
      await client.query(`SET LOCAL ROLE ${PROBE_ROLE}`);
      await client.query(sqlOf('028_remove_supabase_realtime.sql'));
      await client.query('RESET ROLE');

      const after = await state(client);
      assert.deepEqual(after.policies, [...CHANNEL_POLICIES].sort(), 'communications policies dropped; channel policies left');
      assert.equal(after.published, true, 'publication change left');
      assert.equal(after.rls, true);
      const ours = notices.filter((n) => n.startsWith('028:'));
      assert.equal(ours.length, 2, JSON.stringify(notices));
      assert.match(ours[0], /realtime\.messages channel policies left in place \(42501/);
      assert.match(ours[1], /left in the supabase_realtime publication \(42501/);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  test('the communications part is NOT wrapped: if it fails, 028 fails', async (t) => {
    const probe = (await client.query(`SELECT pg_has_role(current_user, (SELECT oid FROM pg_roles WHERE rolname = $1), 'MEMBER') AS ok`, [PROBE_ROLE]).catch(() => ({ rows: [{ ok: false }] }))).rows[0].ok;
    if (!probe) return t.skip(`needs role ${PROBE_ROLE} granted to the test user`);
    await client.query('BEGIN');
    try {
      await supabaseStyle(client);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
      await client.query(`SET LOCAL ROLE ${PROBE_ROLE}`); // not the owner of communications
      await assert.rejects(client.query(sqlOf('028_remove_supabase_realtime.sql')), (err: { code?: string }) => err.code === '42501');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  test('guarded 019/021 still create their policies where Supabase objects exist (existing behaviour on Supabase)', async (t) => {
    const role = (await client.query(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS ok`)).rows[0].ok;
    if (!role) return t.skip('role authenticated does not exist on this server');
    await client.query('BEGIN');
    try {
      await supabaseStyle(client);
      await client.query(sqlOf('028_remove_supabase_realtime.sql'));
      await client.query(sqlOf('019_enable_communications_realtime.sql'));
      await client.query(sqlOf('021_authorize_realtime_channels.sql'));
      assert.deepEqual((await state(client)).policies, [...COMMS_POLICIES, ...CHANNEL_POLICIES].sort());
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
