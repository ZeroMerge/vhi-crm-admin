import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { Client } from 'pg';

// Strict fresh-install test (Phase 5): every migration, from scratch, on an EMPTY plain PostgreSQL database with no Supabase
// objects and no `authenticated` role; then a second run that skips everything. Uses the real migrator (src/db/migrate.ts).
//
// Needs FRESH_DATABASE_URL (passed inline, never written to a file), e.g. postgresql://user:pass@localhost:5433/vhi_crm_fresh.
// Guard: host must be localhost / 127.0.0.1 / ::1 AND the database must be named exactly "vhi_crm_fresh" (any port). The schema is
// dropped and recreated at the start of every run; no other database is ever touched (this file never reads TEST_DATABASE_URL).
//
// NOTE: the server this runs against may give the test user SUPERUSER (the isolated local server does). The test therefore proves
// the ABSENCE of Supabase objects and roles in the install, not least-privilege behaviour.

const FRESH = process.env.FRESH_DATABASE_URL;
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const MIGRATE = path.join(__dirname, '../src/db/migrate.ts');
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function guard(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('FRESH_DATABASE_URL is not a valid connection URL.');
  }
  const host = (u.searchParams.get('host') || u.hostname).replace(/^\[|\]$/g, '').toLowerCase();
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`FRESH_DATABASE_URL must point at localhost, 127.0.0.1 or ::1 (got host "${host}").`);
  if (database !== 'vhi_crm_fresh') throw new Error(`FRESH_DATABASE_URL database must be named "vhi_crm_fresh" (got "${database}").`);
  return url;
}

function migrate(url: string) {
  // From test/ (no .env there, so dotenv loads nothing); DATABASE_URL is the only connection setting passed.
  const r = spawnSync('npx', ['tsx', MIGRATE], { cwd: __dirname, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', shell: true });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe('fresh install on plain PostgreSQL (no Supabase objects, no `authenticated` role)', { skip: FRESH ? false : 'FRESH_DATABASE_URL not set' }, () => {
  let url: string;
  let client: Client;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  before(async () => {
    url = guard(FRESH!);
    client = new Client({ connectionString: url });
    await client.connect();
    assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db, 'vhi_crm_fresh');
    // Start empty: clear the public schema (and leftovers of earlier runs). Extensions live in public, so they go with it.
    await client.query(`DROP SCHEMA IF EXISTS realtime CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
  });
  after(async () => {
    await client?.end();
  });

  const count = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0].n as number;

  test('precondition: no Supabase roles, schemas or publication exist', async () => {
    assert.equal(await count(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('authenticated', 'anon', 'service_role', 'supabase_admin')`), 0);
    assert.equal(await count(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN ('auth', 'realtime', 'storage', 'extensions')`), 0);
    assert.equal(await count(`SELECT count(*)::int AS n FROM pg_publication WHERE pubname = 'supabase_realtime'`), 0);
    assert.equal(await count(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`), 0, 'empty public schema');
  });

  test('every migration applies from scratch', () => {
    const run = migrate(url);
    assert.equal(run.status, 0, run.out.slice(-1500));
    assert.ok(run.out.includes('All migrations applied'));
    const migrated = run.out.split('\n').filter((l) => l.startsWith('Migrated:')).map((l) => l.slice('Migrated: '.length).trim());
    assert.deepEqual(migrated, files, 'every file ran, in name order');
    assert.ok(!run.out.includes('Bootstrapped'), 'a clean install, not a bootstrap');
  });

  test('a second run skips every file', () => {
    const run = migrate(url);
    assert.equal(run.status, 0, run.out.slice(-1500));
    const skipped = run.out.split('\n').filter((l) => l.startsWith('Skipped (already applied):'));
    assert.equal(skipped.length, files.length);
    assert.ok(!run.out.includes('Migrated:'));
  });

  test('result: still no Supabase objects; RLS on communications and the Phase 1–4 tables, no policies', async () => {
    assert.equal(await count('SELECT count(*)::int AS n FROM schema_migrations'), files.length);
    assert.equal(await count(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('authenticated', 'anon')`), 0, 'migrations created no Supabase role');
    assert.equal(await count(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN ('auth', 'realtime')`), 0, 'and no Supabase schema');
    assert.equal(await count(`SELECT count(*)::int AS n FROM pg_publication WHERE pubname = 'supabase_realtime'`), 0);
    const rls = (await client.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[]) ORDER BY relname`,
      [['communications', 'notifications', 'email_deliveries', 'scheduled_job_runs', 'email_suppressions', 'processed_webhooks', 'admin_invites']]
    )).rows;
    assert.equal(rls.length, 7);
    assert.ok(rls.every((r) => r.relrowsecurity && !r.relforcerowsecurity), JSON.stringify(rls));
    assert.equal(await count(`SELECT count(*)::int AS n FROM pg_policy`), 0, 'no policies anywhere (communications ones were never created)');
  });

  test('the app tables work: a customer, a message and a notification round trip', async () => {
    const c = (await client.query(
      `INSERT INTO customers (user_id, firstname, lastname, email, password_hash) VALUES ('VHI-FRESH001', 'F', 'R', 'fresh@test.local', 'x') RETURNING id`
    )).rows[0];
    const m = (await client.query(
      `INSERT INTO communications (customer_id, sender_type, subject, body, read_by_admin, read_by_customer) VALUES ($1, 'customer', 's', 'b', false, true) RETURNING id`,
      [c.id]
    )).rows[0];
    assert.ok(m.id);
    assert.equal(await count('SELECT count(*)::int AS n FROM communications WHERE customer_id = $1', [c.id]), 1, 'the owner reads its own RLS-protected table');
  });
});
