import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

if (process.env.VHI_TEST_SETUP !== '1') {
  throw new Error('test/setup.ts was not preloaded; run tests with `npm test`.');
}

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

// Spread into test()/describe() options: DB tests are skipped (not failed) without a test database.
export const dbTest = hasTestDb ? {} : { skip: 'TEST_DATABASE_URL not set' };

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

// Minimal stand-ins for the Supabase objects referenced by migrations 019 and 021,
// so the real migration files run unchanged on vanilla Postgres. Never used outside tests.
const SUPABASE_STUBS = `
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
  CREATE SCHEMA realtime;
  CREATE TABLE realtime.messages (id BIGSERIAL PRIMARY KEY, topic TEXT);
  CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT current_setting('realtime.topic', true) $$;
`;

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Drops everything and applies every migration in filename order, exactly like src/db/migrate.ts.
export async function resetDatabase() {
  await withClient(async (client) => {
    await client.query(`
      DROP SCHEMA IF EXISTS realtime CASCADE;
      DROP SCHEMA IF EXISTS auth CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
    `);
    await client.query(SUPABASE_STUBS);

    const files = fs.readdirSync(MIGRATIONS_DIR).sort().filter((f) => f.endsWith('.sql'));
    for (const file of files) {
      try {
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8'));
      } catch (err: any) {
        throw new Error(`Migration ${file} failed on the test database: ${err.message}`);
      }
    }
  });
}

// Empties every app table between tests while keeping the schema.
export async function truncateAll() {
  await withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    if (rows.length === 0) return;
    const tables = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
    await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  });
}
