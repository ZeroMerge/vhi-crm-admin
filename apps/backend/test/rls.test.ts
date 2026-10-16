import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { dbTest, resetDatabase } from './helpers/db';
import { insertAdmin, insertCustomer } from './helpers/fixtures';
import pool from '../src/config/db';

// Migration 027 (RISKS R-63): RLS on the Phase 1–4 tables, no policies, not forced.
const TABLES = ['notifications', 'email_deliveries', 'scheduled_job_runs', 'email_suppressions', 'processed_webhooks', 'admin_invites'];

// The non-owner check needs a role the test database user can SET ROLE to. The test user cannot create roles, so it must exist
// already (created once by a superuser):
//   CREATE ROLE vhi_rls_probe NOLOGIN;
//   GRANT vhi_rls_probe TO vhi_test;      -- the role in TEST_DATABASE_URL
const PROBE_ROLE = 'vhi_rls_probe';

describe('row-level security on the Phase 1–4 tables (migration 027)', dbTest, () => {
  let probeReady: string | null = null; // null = usable, else the reason the probe test is skipped

  before(async () => {
    await resetDatabase();
    const { rows } = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists,
              pg_has_role(current_user, (SELECT oid FROM pg_roles WHERE rolname = $1), 'MEMBER') AS member`,
      [PROBE_ROLE]
    ).catch(() => ({ rows: [{ exists: false, member: false }] }));
    if (!rows[0].exists) probeReady = `role ${PROBE_ROLE} does not exist (see the comment at the top of test/rls.test.ts)`;
    else if (!rows[0].member) probeReady = `the test user is not a member of ${PROBE_ROLE} (GRANT ${PROBE_ROLE} TO <test user>)`;
  });
  after(async () => {
    await pool.end();
  });

  test('the migration enables RLS on exactly these tables, without FORCE, and adds no policies', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/027_enable_rls_on_new_tables.sql'), 'utf8');
    assert.ok(!/^\s*ALTER\s+TABLE[^;]*FORCE/im.test(sql), 'no FORCE ROW LEVEL SECURITY');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'no policies');
    const { rows } = await pool.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY c.relname`,
      [TABLES]
    );
    const me = (await pool.query('SELECT current_user AS u')).rows[0].u;
    assert.deepEqual(
      rows.map((r) => [r.relname, r.relrowsecurity, r.relforcerowsecurity, r.owner]),
      [...TABLES].sort().map((t) => [t, true, false, me]),
      'RLS on, not forced, owned by the role the backend connects as'
    );
    const policies = await pool.query(`SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`, [TABLES]);
    assert.equal(policies.rows.length, 0);
  });

  test('running 027 again changes nothing (idempotent)', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/027_enable_rls_on_new_tables.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(sql);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity`, [TABLES]);
    assert.equal(rows[0].n, TABLES.length);
  });

  async function seedOneRowEach(client: import('pg').PoolClient) {
    const admin = await insertAdmin();
    const customer = await insertCustomer();
    const n = await client.query(
      `INSERT INTO notifications (admin_id, module, type, entity_type, entity_id, title, actor_type, dedupe_key)
       VALUES ($1, 'shipments', 'test', 'shipment', gen_random_uuid(), 't', 'system', 'rls-probe') RETURNING id`,
      [admin.id]
    );
    await client.query(`INSERT INTO email_deliveries (kind, to_address, customer_id, notification_id) VALUES ('customer.password_changed', 'x@test.local', $1, $2)`, [customer.id, n.rows[0].id]);
    await client.query(`INSERT INTO scheduled_job_runs (job) VALUES ('rls-probe')`);
    await client.query(`INSERT INTO email_suppressions (address, reason) VALUES ('rls-probe@test.local', 'bounce')`);
    await client.query(`INSERT INTO processed_webhooks (id, provider) VALUES ('rls-probe', 'resend')`);
    await client.query(`INSERT INTO admin_invites (admin_id, token_hash, expires_at) VALUES ($1, decode(md5('rls-probe'), 'hex'), NOW() + interval '1 day')`, [admin.id]);
  }

  test('the owner (the backend) still reads and writes every table with RLS on', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seedOneRowEach(client);
      for (const t of TABLES) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
        assert.ok(rows[0].n >= 1, `${t}: owner sees its rows`);
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('a non-owner role gets zero rows from each new table (even with SELECT granted)', async (t) => {
    if (probeReady) return t.skip(probeReady);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seedOneRowEach(client);
      // Grant what Supabase's anon/authenticated roles have (USAGE on public, SELECT/INSERT on tables), so the result is decided by
      // RLS, not by a permission error. The test schema is recreated by the test user, so nobody else has USAGE on it by default.
      // Everything here is rolled back.
      await client.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
      for (const table of [...TABLES, 'customers']) await client.query(`GRANT SELECT, INSERT ON ${table} TO ${PROBE_ROLE}`);
      await client.query(`SET LOCAL ROLE ${PROBE_ROLE}`);
      for (const table of TABLES) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
        assert.equal(rows[0].n, 0, `${table}: hidden from a non-owner`);
      }
      // Control: a table without RLS (customers) is readable by the same role, so the zeros above come from RLS.
      const control = await client.query('SELECT count(*)::int AS n FROM customers');
      assert.ok(control.rows[0].n >= 1, 'control table readable');
      // Writes are refused by RLS (INSERT is granted, so this is not a plain permission error). It's the last statement:
      // the error aborts the transaction, which is rolled back below.
      await assert.rejects(
        client.query(`INSERT INTO processed_webhooks (id, provider) VALUES ('probe-write', 'x')`),
        (err: { code?: string; message?: string }) => err.code === '42501' && /row-level security/i.test(err.message ?? '')
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
