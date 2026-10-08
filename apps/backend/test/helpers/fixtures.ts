import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../../src/config/db';

// Same claim shapes as src/modules/auth/auth.routes.ts and src/modules/client/client.auth.routes.ts.
export function adminToken(admin: { id: string; email: string; activeRole: string; assignedRoles?: string[] }) {
  return jwt.sign(
    {
      id: admin.id,
      adminId: admin.id,
      email: admin.email,
      activeRole: admin.activeRole,
      assignedRoles: admin.assignedRoles ?? [admin.activeRole],
    },
    process.env.ADMIN_JWT_SECRET!,
    { expiresIn: '1h' }
  );
}

export function customerToken(customer: { id: string; email: string; user_id: string }) {
  return jwt.sign(
    { id: customer.id, email: customer.email, userId: customer.user_id },
    process.env.CLIENT_JWT_SECRET!,
    { expiresIn: '1h' }
  );
}

const unique = () => crypto.randomBytes(4).toString('hex');

// Password hashes are placeholders: these fixtures are for token-authenticated route tests, not login.
export async function insertAdmin(overrides: { assignedRoles?: string[]; isActive?: boolean; deleted?: boolean } = {}) {
  const roles = overrides.assignedRoles ?? ['super_admin'];
  const { rows } = await pool.query(
    `INSERT INTO admins (name, email, password_hash, assigned_roles, is_active, deleted_at)
     VALUES ($1, $2, 'not-a-real-hash', $3, $4, $5)
     RETURNING *`,
    [`Test Admin ${unique()}`, `admin-${unique()}@test.local`, roles, overrides.isActive ?? true, overrides.deleted ? new Date() : null]
  );
  return rows[0];
}

export async function insertCustomer(overrides: { isActive?: boolean } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO customers (user_id, firstname, lastname, email, password_hash, is_active)
     VALUES ($1, 'Test', 'Customer', $2, 'not-a-real-hash', $3)
     RETURNING *`,
    [`VHI-${unique().toUpperCase()}`, `customer-${unique()}@test.local`, overrides.isActive ?? true]
  );
  return rows[0];
}

export async function insertShipment(customerId: string, overrides: { status?: string; shippingMode?: string } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO shipments (order_id, customer_id, shipping_mode, status, is_draft)
     VALUES ($1, $2, $3, $4, false)
     RETURNING *`,
    [`TST${unique()}`, customerId, overrides.shippingMode ?? 'air_freight', overrides.status ?? 'pending']
  );
  return rows[0];
}

export async function insertInvoice(customerId: string, overrides: { amount?: string; status?: string; shipmentId?: string } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO invoices (invoice_number, customer_id, shipment_id, amount, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [`INV-TST-${unique()}`, customerId, overrides.shipmentId ?? null, overrides.amount ?? '100.00', overrides.status ?? 'sent']
  );
  return rows[0];
}
