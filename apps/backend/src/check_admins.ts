import pool from './config/db';
import bcrypt from 'bcryptjs';

async function check() {
  const result = await pool.query('SELECT id, name, email, password_hash, assigned_roles, role FROM admins');
  console.log('--- ADMINS IN DB ---');
  for (const row of result.rows) {
    console.log({
      id: row.id,
      name: row.name,
      email: row.email,
      assigned_roles: row.assigned_roles,
      role: row.role
    });
    
    const isValid = await bcrypt.compare('Admin@123', row.password_hash);
    console.log(`Password 'Admin@123' is ${isValid ? 'VALID' : 'INVALID'} for ${row.email}`);
  }
  await pool.end();
}

check().catch(console.error);
