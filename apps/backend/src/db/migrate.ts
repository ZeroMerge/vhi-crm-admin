import fs from 'fs';
import path from 'path';
import pool from '../config/db';

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort().filter(f => f.endsWith('.sql'));

  // Bootstrap detection: schema_migrations was just introduced into an existing
  // database, so the table is empty even though migrations have already run.
  // In this state, "already exists" errors from old migrations are expected
  // and should be recorded as applied rather than hard-failing the run.
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM schema_migrations`
  );
  const dbCheck = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customers'
  `);
  const bootstrapping = Number(countResult.rows[0].count) === 0 && dbCheck.rows.length > 0;

  if (bootstrapping) {
    console.log('Bootstrapping migration tracking for existing database...');
  }

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (rows.length > 0) {
      console.log(`Skipped (already applied): ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    try {
      await pool.query(sql);
    } catch (err: any) {
      if (bootstrapping && isAlreadyAppliedError(err)) {
        await pool.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
          [file]
        );
        console.log(`Bootstrapped (already applied): ${file}`);
        continue;
      }
      throw err;
    }

    await pool.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`,
      [file]
    );
    console.log(`Migrated: ${file}`);
  }

  console.log('All migrations applied');
  await pool.end();
}

// PostgreSQL error codes for "object already exists" situations:
//   42710 = duplicate_object  (type, function, operator …)
//   42P07 = duplicate_table
//   42701 = duplicate_column
//   42P06 = duplicate_schema
function isAlreadyAppliedError(err: any): boolean {
  return (
    ['42710', '42P07', '42701', '42P06'].includes(err.code) ||
    String(err.message).includes('already exists')
  );
}

migrate().catch(console.error);
