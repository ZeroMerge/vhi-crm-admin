import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin, insertCustomer } from './helpers/fixtures';
import pool from '../src/config/db';
import customersRoutes from '../src/modules/customers/customers.routes';

test('setup runs from test/ with no .env and never targets the default app database', () => {
  assert.equal(process.env.VHI_TEST_SETUP, '1');
  assert.equal(path.resolve(process.cwd()), path.resolve(__dirname));
  assert.equal(fs.existsSync(path.join(process.cwd(), '.env')), false);
  assert.notEqual(process.env.DATABASE_URL, 'postgresql://postgres:postgres@localhost:5432/vhi_crm');
  assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL ?? 'postgresql://no_test_db@127.0.0.1:1/no_test_db');
});

describe('test database harness', dbTest, () => {
  let app: TestApp;

  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/admin/customers', customersRoutes]]);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  after(async () => {
    await app?.close();
    await pool.end();
  });

  test('every migration applies and core tables exist', async () => {
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const tables = rows.map((r) => r.tablename);
    for (const t of ['admins', 'customers', 'shipments', 'tracking_updates', 'invoices', 'payments', 'communications', 'cargo_clearings']) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
  });

  test('truncateAll empties tables between tests', async () => {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM customers');
    assert.equal(rows[0].n, 0);
  });

  test('a real router responds through the harness with an admin token', async () => {
    const admin = await insertAdmin({ assignedRoles: ['super_admin'] });
    const customer = await insertCustomer();
    const token = adminToken({ id: admin.id, email: admin.email, activeRole: 'super_admin' });

    const res = await request(app, 'GET', '/api/admin/customers', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data.map((c: any) => c.id), [customer.id]);

    const unauth = await request(app, 'GET', '/api/admin/customers');
    assert.equal(unauth.status, 401);
  });
});
