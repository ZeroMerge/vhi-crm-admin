const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/vhi_crm';
const pool = new Pool({ connectionString });

(async () => {
  console.log('Testing DB connection to', connectionString);
  try {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT NOW() as now');
      console.log('Connected. Server time:', res.rows[0].now);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('DB connection failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
