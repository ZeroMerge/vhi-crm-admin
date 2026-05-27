import fs from 'fs';
import path from 'path';
import pool from '../config/db';

async function migrate() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {
    if (file.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await pool.query(sql);
      console.log(`Migrated: ${file}`);
    }
  }

  console.log('All migrations applied');
  await pool.end();
}

migrate().catch(console.error);
