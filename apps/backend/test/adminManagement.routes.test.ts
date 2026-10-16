import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import adminManagementRoutes from '../src/modules/admin/admin_management.routes';

describe('/api/admin/admins account check (R-55)', dbTest, () => {
  let app: TestApp;

  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/admin/admins', adminManagementRoutes]]);
  });
  beforeEach(async () => {
    await truncateAll();
    clearAdminAccountCache();
  });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const invite = (token: string) =>
    request(app, 'POST', '/api/admin/admins/invite', {
      token,
      body: { name: 'New Admin', email: `new-${crypto.randomUUID()}@test.local`, assignedRoles: ['manager'] },
    });

  test('an active super_admin can still invite and reset passwords', async () => {
    const sa = await insertAdmin({ assignedRoles: ['super_admin'] });
    const target = await insertAdmin({ assignedRoles: ['manager'] });
    const token = adminToken({ id: sa.id, email: sa.email, activeRole: 'super_admin' });
    assert.equal((await invite(token)).status, 201);
    assert.equal((await request(app, 'POST', `/api/admin/admins/${target.id}/reset-password`, { token, body: {} })).status, 200);
  });

  for (const [label, overrides] of [
    ['inactive', { isActive: false }],
    ['deleted', { deleted: true }],
  ] as const) {
    test(`a ${label} super_admin gets 401 on invite and reset-password`, async () => {
      const sa = await insertAdmin({ assignedRoles: ['super_admin'], ...overrides });
      const target = await insertAdmin({ assignedRoles: ['manager'] });
      const token = adminToken({ id: sa.id, email: sa.email, activeRole: 'super_admin' });
      const before = (await pool.query('SELECT COUNT(*)::int AS n FROM admins')).rows[0].n;
      const hashBefore = (await pool.query('SELECT password_hash FROM admins WHERE id = $1', [target.id])).rows[0].password_hash;

      assert.equal((await invite(token)).status, 401);
      assert.equal((await request(app, 'POST', `/api/admin/admins/${target.id}/reset-password`, { token, body: {} })).status, 401);

      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM admins')).rows[0].n, before, 'no admin invited');
      const hashAfter = (await pool.query('SELECT password_hash FROM admins WHERE id = $1', [target.id])).rows[0].password_hash;
      assert.equal(hashAfter, hashBefore, 'password unchanged');
    });
  }

  test('non-super_admin roles are still refused (403)', async () => {
    const m = await insertAdmin({ assignedRoles: ['manager'] });
    assert.equal((await invite(adminToken({ id: m.id, email: m.email, activeRole: 'manager' }))).status, 403);
  });
});
