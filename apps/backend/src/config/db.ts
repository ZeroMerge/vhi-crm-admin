import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const getDatabaseUrl = () =>
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/vhi_crm';

const pool = new Pool({
  connectionString: getDatabaseUrl(),
});

export const query = async (text: string, params?: any[]) => {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};

export default pool;
