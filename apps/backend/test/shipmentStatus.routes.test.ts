import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, customerToken, insertAdmin, insertCustomer, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import shipmentsRoutes from '../src/modules/shipments/shipments.routes';
import clientShipmentsRoutes from '../src/modules/client/client.shipments.routes';

describe('shipment status routes', dbTest, () => {
  let app: TestApp;

  before(async () => {
    await resetDatabase();
    app = await startApp([
      ['/api/admin/shipments', shipmentsRoutes],
      ['/api/client/shipments', clientShipmentsRoutes],
    ]);
  });
  beforeEach(async () => { await truncateAll(); });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  async function asAdmin(role: string) {
    const admin = await insertAdmin({ assignedRoles: [role] });
    return { admin, token: adminToken({ id: admin.id, email: admin.email, activeRole: role }) };
  }
  const statusOf = async (id: string) => (await pool.query('SELECT status FROM shipments WHERE id = $1', [id])).rows[0].status;
  const count = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0].n as number;
  const auditRows = (id: string) =>
    pool.query(`SELECT action, metadata FROM audit_logs WHERE resource_id = $1 ORDER BY created_at`, [id]).then((r) => r.rows);

  describe('PUT /api/admin/shipments/:id/status', () => {
    test('forward move: updates, audits from/to/reason/isCorrection, returns allowedTransitions', async () => {
      const { token } = await asAdmin('logistics_officer');
      const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });

      const res = await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'processing', expectedStatus: 'pending' } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'processing');
      assert.deepEqual(res.body.data.allowedTransitions.map((t: any) => t.to), ['pending', 'in_transit', 'cancelled']);
      assert.equal(await statusOf(s.id), 'processing');

      const [audit] = await auditRows(s.id);
      assert.equal(audit.action, 'UPDATE_SHIPMENT_STATUS');
      assert.deepEqual(
        { from: audit.metadata.from, to: audit.metadata.to, reason: audit.metadata.reason, isCorrection: audit.metadata.isCorrection },
        { from: 'pending', to: 'processing', reason: null, isCorrection: false }
      );
    });

    test('invalid enum value is 400 (not 500) and writes nothing', async () => {
      const { token } = await asAdmin('manager');
      const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });
      for (const status of ['shipped', '', null, 7]) {
        const res = await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status, message: 'x' } });
        assert.equal(res.status, 400, `status=${JSON.stringify(status)}`);
      }
      assert.equal(await statusOf(s.id), 'pending');
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM tracking_updates'), 0);
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM audit_logs'), 0);
    });

    test('same status is 400 with no audit row', async () => {
      const { token } = await asAdmin('manager');
      const s = await insertShipment((await insertCustomer()).id, { status: 'processing' });
      const res = await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'processing' } });
      assert.equal(res.status, 400);
      assert.equal((await auditRows(s.id)).length, 0);
    });

    test('disallowed jump is 400; role restriction is 403; missing reason is 400', async () => {
      const logistics = await asAdmin('logistics_officer');
      const manager = await asAdmin('manager');
      const c = await insertCustomer();
      const pending = await insertShipment(c.id, { status: 'pending' });
      const inTransit = await insertShipment(c.id, { status: 'in_transit' });

      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${pending.id}/status`, { token: manager.token, body: { status: 'delivered' } })).status, 400);
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${inTransit.id}/status`, { token: logistics.token, body: { status: 'cancelled', reason: 'r' } })).status, 403);
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${inTransit.id}/status`, { token: manager.token, body: { status: 'cancelled' } })).status, 400);
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${pending.id}/status`, { token: logistics.token, body: { status: 'cancelled' } })).status, 400);
      assert.equal(await statusOf(pending.id), 'pending');
      assert.equal(await statusOf(inTransit.id), 'in_transit');

      const ok = await request(app, 'PUT', `/api/admin/shipments/${inTransit.id}/status`, { token: manager.token, body: { status: 'cancelled', reason: 'Customer withdrew' } });
      assert.equal(ok.status, 200);
      const [audit] = await auditRows(inTransit.id);
      assert.equal(audit.metadata.reason, 'Customer withdrew');
    });

    test('correction requires a reason and is audited as isCorrection', async () => {
      const { token } = await asAdmin('logistics_officer');
      const s = await insertShipment((await insertCustomer()).id, { status: 'clearance' });
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'in_transit' } })).status, 400);
      const res = await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'in_transit', reason: 'Marked clearance by mistake' } });
      assert.equal(res.status, 200);
      const [audit] = await auditRows(s.id);
      assert.equal(audit.metadata.isCorrection, true);
      assert.equal(audit.metadata.reason, 'Marked clearance by mistake');
    });

    test('message creates a tracking row atomically; a rejected change leaves no tracking row', async () => {
      const { token } = await asAdmin('manager');
      const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'delivered', message: 'nope' } })).status, 400);
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM tracking_updates'), 0);

      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'processing', message: 'Packed' } })).status, 200);
      const rows = (await pool.query('SELECT status, message FROM tracking_updates WHERE shipment_id = $1', [s.id])).rows;
      assert.deepEqual(rows, [{ status: 'processing', message: 'Packed' }]);
    });

    test('stale expectedStatus is 409 and writes nothing', async () => {
      const { token } = await asAdmin('manager');
      const s = await insertShipment((await insertCustomer()).id, { status: 'processing' });
      const res = await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'in_transit', expectedStatus: 'pending' } });
      assert.equal(res.status, 409);
      assert.equal(await statusOf(s.id), 'processing');
      assert.equal((await auditRows(s.id)).length, 0);
    });

    test('a row locked by another transaction is 409, not last-write-wins', async () => {
      const { token } = await asAdmin('manager');
      const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });
      const other = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await other.connect();
      try {
        await other.query('BEGIN');
        await other.query('SELECT id FROM shipments WHERE id = $1 FOR UPDATE', [s.id]);
        const res = await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'processing' } });
        assert.equal(res.status, 409);
      } finally {
        await other.query('ROLLBACK');
        await other.end();
      }
      assert.equal(await statusOf(s.id), 'pending');
    });

    test('two concurrent conflicting changes: exactly one wins, the other gets 409', async () => {
      const a = await asAdmin('manager');
      const b = await asAdmin('logistics_officer');
      const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });
      const [r1, r2] = await Promise.all([
        request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token: a.token, body: { status: 'processing', expectedStatus: 'pending' } }),
        request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token: b.token, body: { status: 'cancelled', reason: 'dup', expectedStatus: 'pending' } }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
      assert.equal((await auditRows(s.id)).length, 1);
    });

    test('unknown id is 404 for both malformed and missing UUIDs', async () => {
      const { token } = await asAdmin('manager');
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/not-a-uuid/status`, { token, body: { status: 'processing' } })).status, 404);
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/00000000-0000-0000-0000-000000000000/status`, { token, body: { status: 'processing' } })).status, 404);
    });
  });

  describe('GET /api/admin/shipments/:id allowedTransitions', () => {
    test('depends on the caller role; existing rows in every status get sensible options', async () => {
      const manager = await asAdmin('manager');
      const logistics = await asAdmin('logistics_officer');
      const c = await insertCustomer();
      const expected: Record<string, { manager: string[]; logistics: string[] }> = {
        draft: { manager: ['pending', 'cancelled'], logistics: ['pending', 'cancelled'] },
        pending: { manager: ['processing', 'cancelled'], logistics: ['processing', 'cancelled'] },
        processing: { manager: ['pending', 'in_transit', 'cancelled'], logistics: ['pending', 'in_transit', 'cancelled'] },
        in_transit: { manager: ['processing', 'clearance', 'delivered', 'cancelled'], logistics: ['processing', 'clearance', 'delivered'] },
        clearance: { manager: ['in_transit', 'delivered', 'cancelled'], logistics: ['in_transit', 'delivered'] },
        delivered: { manager: ['in_transit', 'clearance'], logistics: [] },
        cancelled: { manager: ['pending'], logistics: [] },
      };
      for (const [status, want] of Object.entries(expected)) {
        const s = await insertShipment(c.id, { status });
        const m = await request(app, 'GET', `/api/admin/shipments/${s.id}`, { token: manager.token });
        const l = await request(app, 'GET', `/api/admin/shipments/${s.id}`, { token: logistics.token });
        assert.equal(m.status, 200);
        assert.deepEqual(m.body.data.allowedTransitions.map((t: any) => t.to), want.manager, `manager @ ${status}`);
        assert.deepEqual(l.body.data.allowedTransitions.map((t: any) => t.to), want.logistics, `logistics @ ${status}`);
      }
    });
  });

  describe('POST /api/admin/shipments initial status', () => {
    const body = (customerId: string, extra: object = {}) => ({
      customerId, shippingMode: 'air_freight', natureOfItem: 'Parts', originAddress: 'A', destinationAddress: 'B', ...extra,
    });
    test('defaults to pending, accepts the allowed set, rejects others with 400', async () => {
      const { token } = await asAdmin('manager');
      const c = await insertCustomer();
      const def = await request(app, 'POST', '/api/admin/shipments', { token, body: body(c.id) });
      assert.equal(def.status, 201);
      assert.equal(def.body.data.status, 'pending');
      for (const status of ['draft', 'processing', 'in_transit', 'clearance']) {
        assert.equal((await request(app, 'POST', '/api/admin/shipments', { token, body: body(c.id, { status }) })).status, 201, status);
      }
      for (const status of ['delivered', 'cancelled', 'shipped']) {
        assert.equal((await request(app, 'POST', '/api/admin/shipments', { token, body: body(c.id, { status }) })).status, 400, status);
      }
      assert.equal(await count('SELECT COUNT(*)::int AS n FROM shipments'), 5);
    });
  });

  describe('DELETE /api/client/shipments/:orderId (customer cancel)', () => {
    test('pending → cancelled; any other status keeps the existing 403 message; others\x27 shipments are 404', async () => {
      const c = await insertCustomer();
      const other = await insertCustomer();
      const token = customerToken(c);
      const pending = await insertShipment(c.id, { status: 'pending' });

      const ok = await request(app, 'DELETE', `/api/client/shipments/${pending.order_id}`, { token });
      assert.equal(ok.status, 200);
      assert.equal(await statusOf(pending.id), 'cancelled');
      const [audit] = await auditRows(pending.id);
      assert.deepEqual([audit.action, audit.metadata.from, audit.metadata.to], ['CANCEL_SHIPMENT', 'pending', 'cancelled']);

      for (const status of ['draft', 'processing', 'in_transit', 'clearance', 'delivered', 'cancelled']) {
        const s = await insertShipment(c.id, { status });
        const res = await request(app, 'DELETE', `/api/client/shipments/${s.order_id}`, { token });
        assert.equal(res.status, 403, status);
        assert.equal(res.body.message, 'Shipment cannot be modified after processing has begun');
        assert.equal(await statusOf(s.id), status);
      }

      const theirs = await insertShipment(other.id, { status: 'pending' });
      assert.equal((await request(app, 'DELETE', `/api/client/shipments/${theirs.order_id}`, { token })).status, 404);
      assert.equal(await statusOf(theirs.id), 'pending');
    });

    test('locked row is 409', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      const other = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await other.connect();
      try {
        await other.query('BEGIN');
        await other.query('SELECT id FROM shipments WHERE id = $1 FOR UPDATE', [s.id]);
        assert.equal((await request(app, 'DELETE', `/api/client/shipments/${s.order_id}`, { token: customerToken(c) })).status, 409);
      } finally {
        await other.query('ROLLBACK');
        await other.end();
      }
      assert.equal(await statusOf(s.id), 'pending');
    });
  });
});
