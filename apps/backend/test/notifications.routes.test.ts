import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, customerToken, insertAdmin, insertCustomer } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import { adminNotificationsRoutes, clientNotificationsRoutes } from '../src/modules/notifications/notifications.routes';
import communicationsRoutes from '../src/modules/communications/communications.routes';
import clientCommunicationsRoutes from '../src/modules/client/client.communications.routes';

describe('notification endpoints', dbTest, () => {
  let app: TestApp;

  before(async () => {
    await resetDatabase();
    app = await startApp([
      ['/api/admin/notifications', adminNotificationsRoutes],
      ['/api/client/notifications', clientNotificationsRoutes],
      ['/api/admin/communications', communicationsRoutes],
      ['/api/client/communications', clientCommunicationsRoutes],
    ]);
  });
  beforeEach(async () => {
    await truncateAll();
    clearAdminAccountCache();
  });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  async function addNotification(opts: {
    adminId?: string; customerId?: string; module?: string | null; type?: string; entityType?: string; entityId?: string; read?: boolean;
  }): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO notifications (admin_id, customer_id, module, type, entity_type, entity_id, title, body, data, actor_type, dedupe_key, read_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'T', 'B', '{}'::jsonb, 'system', $7, $8) RETURNING id`,
      [
        opts.adminId ?? null,
        opts.customerId ?? null,
        opts.adminId ? opts.module ?? 'shipments' : null,
        opts.type ?? 'shipment.created',
        opts.entityType ?? 'shipment',
        opts.entityId ?? crypto.randomUUID(),
        `test:${crypto.randomUUID()}`,
        opts.read ? new Date() : null,
      ]
    );
    return String(rows[0].id);
  }
  const asAdmin = async (roles: string[], activeRole = roles[0]) => {
    const a = await insertAdmin({ assignedRoles: roles });
    return { a, token: adminToken({ id: a.id, email: a.email, activeRole, assignedRoles: roles }) };
  };
  const readAtOf = async (id: string) => (await pool.query('SELECT read_at FROM notifications WHERE id = $1', [id])).rows[0].read_at;

  describe('scoping', () => {
    test('admins and customers only ever see and mark their own rows; others\x27 ids are 404', async () => {
      const me = await asAdmin(['manager']);
      const other = await asAdmin(['manager']);
      const cust = await insertCustomer();
      const otherCust = await insertCustomer();
      const mine = await addNotification({ adminId: me.a.id });
      const theirs = await addNotification({ adminId: other.a.id });
      const custRow = await addNotification({ customerId: cust.id });
      const otherCustRow = await addNotification({ customerId: otherCust.id });

      const list = await request(app, 'GET', '/api/admin/notifications', { token: me.token });
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.data.map((n: any) => n.id), [mine]);
      assert.equal((await request(app, 'POST', `/api/admin/notifications/${theirs}/read`, { token: me.token })).status, 404);
      assert.equal((await request(app, 'POST', `/api/admin/notifications/${custRow}/read`, { token: me.token })).status, 404);
      assert.equal(await readAtOf(theirs), null);

      const ct = customerToken(cust);
      const clist = await request(app, 'GET', '/api/client/notifications', { token: ct });
      assert.deepEqual(clist.body.data.map((n: any) => n.id), [custRow]);
      assert.equal((await request(app, 'POST', `/api/client/notifications/${mine}/read`, { token: ct })).status, 404, 'customer cannot touch admin rows');
      assert.equal((await request(app, 'POST', `/api/client/notifications/${otherCustRow}/read`, { token: ct })).status, 404);
      assert.equal(await readAtOf(mine), null);

      assert.equal((await request(app, 'GET', '/api/admin/notifications', { token: ct })).status, 401, 'customer token rejected on admin endpoints');
      assert.equal((await request(app, 'GET', '/api/client/notifications', { token: me.token })).status, 401, 'admin token rejected on client endpoints');
    });

    test('malformed ids are 404; mark-read is idempotent; state changes are POST-only', async () => {
      const me = await asAdmin(['manager']);
      const id = await addNotification({ adminId: me.a.id });
      for (const bad of ['abc', '0', '-1', '1.5', '99999999999999999999']) {
        assert.equal((await request(app, 'POST', `/api/admin/notifications/${bad}/read`, { token: me.token })).status, 404, bad);
      }
      const first = await request(app, 'POST', `/api/admin/notifications/${id}/read`, { token: me.token });
      assert.equal(first.status, 200);
      const second = await request(app, 'POST', `/api/admin/notifications/${id}/read`, { token: me.token });
      assert.equal(second.status, 200);
      assert.equal(second.body.data.readAt, first.body.data.readAt, 'read_at kept on repeat');
      assert.equal((await request(app, 'GET', `/api/admin/notifications/${id}/read`, { token: me.token })).status, 404);
      assert.equal((await request(app, 'PUT', `/api/admin/notifications/read-all`, { token: me.token })).status, 404);
    });

    test('unread-count and read-all only cover the caller\x27s own visible rows', async () => {
      const me = await asAdmin(['manager']);
      const other = await asAdmin(['manager']);
      const cust = await insertCustomer();
      for (let i = 0; i < 3; i++) await addNotification({ adminId: me.a.id });
      await addNotification({ adminId: me.a.id, read: true });
      const otherRow = await addNotification({ adminId: other.a.id });
      const custRow = await addNotification({ customerId: cust.id });

      assert.equal((await request(app, 'GET', '/api/admin/notifications/unread-count', { token: me.token })).body.data.count, 3);
      const all = await request(app, 'POST', '/api/admin/notifications/read-all', { token: me.token });
      assert.equal(all.body.data.updated, 3);
      assert.equal((await request(app, 'GET', '/api/admin/notifications/unread-count', { token: me.token })).body.data.count, 0);
      assert.equal(await readAtOf(otherRow), null);
      assert.equal(await readAtOf(custRow), null);

      const ct = customerToken(cust);
      assert.equal((await request(app, 'GET', '/api/client/notifications/unread-count', { token: ct })).body.data.count, 1);
      assert.equal((await request(app, 'POST', '/api/client/notifications/read-all', { token: ct })).body.data.updated, 1);
      assert.equal(await readAtOf(otherRow), null);
    });
  });

  describe('cursor pagination', () => {
    test('newest first, default 20, nextCursor until the end; boundaries and validation', async () => {
      const me = await asAdmin(['manager']);
      const created: string[] = [];
      for (let i = 0; i < 45; i++) created.push(await addNotification({ adminId: me.a.id }));
      const newestFirst = [...created].reverse();
      const get = (q: string) => request(app, 'GET', `/api/admin/notifications${q}`, { token: me.token });

      const p1 = await get('');
      assert.deepEqual(p1.body.data.map((n: any) => n.id), newestFirst.slice(0, 20));
      assert.equal(p1.body.nextCursor, newestFirst[19]);
      const p2 = await get(`?before=${p1.body.nextCursor}`);
      assert.deepEqual(p2.body.data.map((n: any) => n.id), newestFirst.slice(20, 40));
      const p3 = await get(`?before=${p2.body.nextCursor}`);
      assert.deepEqual(p3.body.data.map((n: any) => n.id), newestFirst.slice(40));
      assert.equal(p3.body.nextCursor, null, 'last page');

      const exact = await get(`?before=${newestFirst[24]}&limit=20`);
      assert.equal(exact.body.data.length, 20, 'exactly limit rows remain');
      assert.equal(exact.body.nextCursor, null, 'no phantom next page when exactly limit rows remain');

      assert.equal((await get('?limit=100')).body.data.length, 45, 'all 45 when fewer than the cap');
      for (let i = 0; i < 10; i++) await addNotification({ adminId: me.a.id });
      const capped = await get('?limit=100');
      assert.equal(capped.body.data.length, 50, 'limit capped at 50');
      assert.ok(capped.body.nextCursor);
      assert.deepEqual((await get(`?before=${created[0]}`)).body.data, [], 'nothing before the oldest');

      for (const bad of ['?limit=0', '?limit=-1', '?limit=abc', '?limit=1.5', '?before=abc', '?before=0', '?before=99999999999999999999']) {
        assert.equal((await get(bad)).status, 400, bad);
      }
    });
  });

  describe('admin module filtering', () => {
    test('rows of a module stop showing (and cannot be marked) once the admin loses every role that reads it', async () => {
      const me = await asAdmin(['finance_officer', 'logistics_officer'], 'finance_officer');
      const ship = await addNotification({ adminId: me.a.id, module: 'shipments' });
      const comms = await addNotification({ adminId: me.a.id, module: 'communications' });
      const listIds = async () => (await request(app, 'GET', '/api/admin/notifications', { token: me.token })).body.data.map((n: any) => n.id).sort();

      assert.deepEqual(await listIds(), [ship, comms].sort(), 'logistics_officer grants communications');
      await pool.query(`UPDATE admins SET assigned_roles = ARRAY['finance_officer'] WHERE id = $1`, [me.a.id]);
      assert.deepEqual(await listIds(), [ship], 'communications hidden after losing logistics_officer');
      assert.equal((await request(app, 'GET', '/api/admin/notifications/unread-count', { token: me.token })).body.data.count, 1);
      assert.equal((await request(app, 'POST', `/api/admin/notifications/${comms}/read`, { token: me.token })).status, 404);
      assert.equal((await request(app, 'POST', '/api/admin/notifications/read-all', { token: me.token })).body.data.updated, 1);
      assert.equal(await readAtOf(comms), null, 'hidden row untouched by read-all');
    });

    test('super_admin sees every module', async () => {
      const sa = await asAdmin(['super_admin']);
      for (const module of ['shipments', 'communications', 'invoices', 'team']) await addNotification({ adminId: sa.a.id, module });
      assert.equal((await request(app, 'GET', '/api/admin/notifications', { token: sa.token })).body.data.length, 4);
    });

    test('inactive admins are rejected by the account check', async () => {
      const a = await insertAdmin({ assignedRoles: ['manager'], isActive: false });
      const t = adminToken({ id: a.id, email: a.email, activeRole: 'manager' });
      assert.equal((await request(app, 'GET', '/api/admin/notifications', { token: t })).status, 401);
    });
  });

  describe('linked read', () => {
    test('a communications admin opening a thread marks only their notifications for that thread', async () => {
      const crm = await asAdmin(['crm_officer']);
      const other = await asAdmin(['crm_officer']);
      const fin = await asAdmin(['finance_officer']);
      const c1 = await insertCustomer();
      const c2 = await insertCustomer();
      const msg = (adminId: string, thread: string) =>
        addNotification({ adminId, module: 'communications', type: 'message.received', entityType: 'customer_thread', entityId: thread });
      const mineC1 = await msg(crm.a.id, c1.id);
      const mineC2 = await msg(crm.a.id, c2.id);
      const mineShipment = await addNotification({ adminId: crm.a.id, module: 'shipments', entityId: c1.id });
      const otherC1 = await msg(other.a.id, c1.id);
      const finC1 = await msg(fin.a.id, c1.id);

      assert.equal((await request(app, 'GET', `/api/admin/communications/${c1.id}`, { token: crm.token })).status, 200);
      assert.notEqual(await readAtOf(mineC1), null);
      assert.equal(await readAtOf(mineC2), null, 'other thread untouched');
      assert.equal(await readAtOf(mineShipment), null, 'other notification types untouched');
      assert.equal(await readAtOf(otherC1), null, 'other admins untouched');

      assert.equal((await request(app, 'GET', `/api/admin/communications/${c1.id}`, { token: fin.token })).status, 200);
      assert.equal(await readAtOf(finC1), null, 'cross-module reader (finance) does not mark read');
    });

    test('a customer opening Mail marks only their message notifications read', async () => {
      const c = await insertCustomer();
      const other = await insertCustomer();
      const msg = await addNotification({ customerId: c.id, type: 'message.received', entityType: 'customer_thread', entityId: c.id });
      const ship = await addNotification({ customerId: c.id, type: 'shipment.status_changed' });
      const otherMsg = await addNotification({ customerId: other.id, type: 'message.received', entityType: 'customer_thread', entityId: other.id });
      assert.equal((await request(app, 'GET', '/api/client/communications', { token: customerToken(c) })).status, 200);
      assert.notEqual(await readAtOf(msg), null);
      assert.equal(await readAtOf(ship), null);
      assert.equal(await readAtOf(otherMsg), null);
    });
  });
});
