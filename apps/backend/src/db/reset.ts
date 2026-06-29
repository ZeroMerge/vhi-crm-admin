import bcrypt from 'bcryptjs';
import pool from '../config/db';

async function run() {
  console.log('Resetting all admin passwords to "password123"...');
  const passwordHash = await bcrypt.hash('password123', 10);

  
  await pool.query('UPDATE admins SET password_hash = $1', [passwordHash]);

  
  const queryText = `
    INSERT INTO admins (name, email, password_hash, role, assigned_roles, notification_prefs, is_active)
    VALUES 
      ('Super Admin', 'admin@valuehandlers.com', $1, 'super_admin', ARRAY['super_admin'], '{}', true),
      ('Manager Lead', 'manager@valuehandlers.com', $1, 'manager', ARRAY['manager'], '{}', true),
      ('Finance Dept', 'finance@valuehandlers.com', $1, 'account_officer', ARRAY['account_officer'], '{}', true),
      ('Logistics Agent', 'logistics@valuehandlers.com', $1, 'operations_manager', ARRAY['operations_manager'], '{}', true),
      ('CRM Officer', 'crm@valuehandlers.com', $1, 'sales_officer', ARRAY['sales_officer'], '{}', true),
      ('Support Agent', 'support@valuehandlers.com', $1, 'support_staff', ARRAY['support_staff'], '{}', true)
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      assigned_roles = EXCLUDED.assigned_roles,
      name = EXCLUDED.name,
      is_active = EXCLUDED.is_active
  `;

  await pool.query(queryText, [passwordHash]);
  console.log('Successfully set all admin passwords to "password123".');

  const res = await pool.query('SELECT name, email, role, assigned_roles FROM admins');
  console.log('Current admins in DB:', res.rows);

  await pool.end();
}

run().catch(console.error);
