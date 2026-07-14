"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = __importDefault(require("../config/db"));
async function migrate() {
    await db_1.default.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    const migrationsDir = path_1.default.join(__dirname, 'migrations');
    const files = fs_1.default.readdirSync(migrationsDir).sort().filter(f => f.endsWith('.sql'));
    // Bootstrap detection: schema_migrations was just introduced into an existing
    // database, so the table is empty even though migrations have already run.
    // In this state, "already exists" errors from old migrations are expected
    // and should be recorded as applied rather than hard-failing the run.
    const countResult = await db_1.default.query(`SELECT COUNT(*)::int AS count FROM schema_migrations`);
    const dbCheck = await db_1.default.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customers'
  `);
    const bootstrapping = Number(countResult.rows[0].count) === 0 && dbCheck.rows.length > 0;
    if (bootstrapping) {
        console.log('Bootstrapping migration tracking for existing database...');
    }
    for (const file of files) {
        const { rows } = await db_1.default.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
        if (rows.length > 0) {
            console.log(`Skipped (already applied): ${file}`);
            continue;
        }
        const sql = fs_1.default.readFileSync(path_1.default.join(migrationsDir, file), 'utf-8');
        try {
            await db_1.default.query(sql);
        }
        catch (err) {
            if (bootstrapping && isAlreadyAppliedError(err)) {
                await db_1.default.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
                console.log(`Bootstrapped (already applied): ${file}`);
                continue;
            }
            throw err;
        }
        await db_1.default.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
        console.log(`Migrated: ${file}`);
    }
    console.log('All migrations applied');
    await db_1.default.end();
}
// PostgreSQL error codes for "object already exists" situations:
//   42710 = duplicate_object  (type, function, operator …)
//   42P07 = duplicate_table
//   42701 = duplicate_column
//   42P06 = duplicate_schema
function isAlreadyAppliedError(err) {
    return (['42710', '42P07', '42701', '42P06'].includes(err.code) ||
        String(err.message).includes('already exists'));
}
migrate().catch(console.error);
//# sourceMappingURL=migrate.js.map