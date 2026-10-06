import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { Client } from 'pg';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin, insertCustomer, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import { adminTrackingRoutes } from '../src/modules/tracking/tracking.routes';

describe('POST /api/admin/tracking/:shipmentId/update', dbTest, () => {
  let app: TestApp;

  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/admin/tracking', adminTrackingRoutes]]);
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
  const shipmentRow = async (id: string) => (await pool.query('SELECT status, updated_at FROM shipments WHERE id = $1', [id])).rows[0];
  const trackingRows = async (id: string) =>
    (await pool.query('SELECT status, message FROM tracking_updates WHERE shipment_id = $1 ORDER BY created_at', [id])).rows;
  const audits = async (id: string) =>
    (await pool.query(`SELECT metadata FROM audit_logs WHERE resource_id = $1 AND action = 'ADD_TRACKING_UPDATE'`, [id])).rows.map((r) => r.metadata);
  const post = (token: string, id: string, body: object) => request(app, 'POST', `/api/admin/tracking/${id}/update`, { token, body });

  async function assertNothingWritten(id: string, status: string) {
    assert.equal((await shipmentRow(id)).status, status, 'shipment status unchanged');
    assert.deepEqual(await trackingRows(id), [], 'no tracking rows');
    assert.deepEqual(await audits(id), [], 'no audit rows');
  }

  test('status change: updates shipment and inserts one tracking row atomically, audited with from/to', async () => {
    const { token } = await asAdmin('logistics_officer');
    const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });
    const res = await post(token, s.id, { status: 'processing', message: 'Packed at warehouse' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'processing');
    assert.equal((await shipmentRow(s.id)).status, 'processing');
    assert.deepEqual(await trackingRows(s.id), [{ status: 'processing', message: 'Packed at warehouse' }]);
    const [audit] = await audits(s.id);
    assert.deepEqual(
      [audit.noteOnly, audit.from, audit.to, audit.isCorrection, audit.reason],
      [false, 'pending', 'processing', false, null]
    );
  });

  test('status change without a message still records a tracking row', async () => {
    const { token } = await asAdmin('manager');
    const s = await insertShipment((await insertCustomer()).id, { status: 'in_transit' });
    assert.equal((await post(token, s.id, { status: 'delivered' })).status, 200);
    assert.deepEqual(await trackingRows(s.id), [{ status: 'delivered', message: '' }]);
  });

  test('note-only: no status, or the same status, writes one tracking row and leaves the shipment untouched', async () => {
    const { token } = await asAdmin('logistics_officer');
    const s = await insertShipment((await insertCustomer()).id, { status: 'in_transit' });
    const before = await shipmentRow(s.id);

    assert.equal((await post(token, s.id, { message: 'Arrived at Paris hub' })).status, 200);
    assert.equal((await post(token, s.id, { status: 'in_transit', message: 'Departed Paris hub' })).status, 200);
    assert.equal((await post(token, s.id, { status: '', message: '  Delayed by weather  ' })).status, 200);

    const after = await shipmentRow(s.id);
    assert.equal(after.status, 'in_transit');
    assert.equal(after.updated_at.getTime(), before.updated_at.getTime(), 'shipment row not touched');
    assert.deepEqual(await trackingRows(s.id), [
      { status: 'in_transit', message: 'Arrived at Paris hub' },
      { status: 'in_transit', message: 'Departed Paris hub' },
      { status: 'in_transit', message: 'Delayed by weather' },
    ]);
    const a = await audits(s.id);
    assert.equal(a.length, 3);
    assert.ok(a.every((m) => m.noteOnly === true && m.status === 'in_transit'));
  });

  test('note-only without a message is 400 and writes nothing', async () => {
    const { token } = await asAdmin('manager');
    const s = await insertShipment((await insertCustomer()).id, { status: 'processing' });
    for (const body of [{}, { message: '' }, { message: '   ' }, { status: 'processing' }]) {
      assert.equal((await post(token, s.id, body)).status, 400, JSON.stringify(body));
    }
    await assertNothingWritten(s.id, 'processing');
  });

  test('invalid input is rejected before any write', async () => {
    const { token } = await asAdmin('manager');
    const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });
    assert.equal((await post(token, s.id, { status: 'shipped', message: 'x' })).status, 400);
    assert.equal((await post(token, s.id, { status: 7, message: 'x' })).status, 400);
    assert.equal((await post(token, s.id, { message: 42 })).status, 400);
    assert.equal((await post(token, 'not-a-uuid', { message: 'x' })).status, 404);
    assert.equal((await post(token, crypto.randomUUID(), { message: 'x' })).status, 404);
    await assertNothingWritten(s.id, 'pending');
  });

  test('state machine applies: disallowed jump 400, role limit 403, missing reason 400, with no orphan tracking rows', async () => {
    const logistics = await asAdmin('logistics_officer');
    const manager = await asAdmin('manager');
    const c = await insertCustomer();
    const pending = await insertShipment(c.id, { status: 'pending' });
    const inTransit = await insertShipment(c.id, { status: 'in_transit' });

    assert.equal((await post(manager.token, pending.id, { status: 'delivered', message: 'skip ahead' })).status, 400);
    assert.equal((await post(logistics.token, inTransit.id, { status: 'cancelled', reason: 'r', message: 'x' })).status, 403);
    assert.equal((await post(manager.token, inTransit.id, { status: 'processing', message: 'oops' })).status, 400);
    await assertNothingWritten(pending.id, 'pending');
    await assertNothingWritten(inTransit.id, 'in_transit');

    const ok = await post(manager.token, inTransit.id, { status: 'processing', reason: 'Scanned in transit by mistake' });
    assert.equal(ok.status, 200);
    const [audit] = await audits(inTransit.id);
    assert.equal(audit.isCorrection, true);
    assert.equal(audit.reason, 'Scanned in transit by mistake');
  });

  test('failure after the status UPDATE rolls back everything (no orphan rows, status unchanged)', async () => {
    // A token for an admin id that is not in the admins table: the shipments UPDATE succeeds,
    // then the tracking_updates insert fails on its updated_by foreign key.
    const ghost = adminToken({ id: crypto.randomUUID(), email: 'ghost@test.local', activeRole: 'manager' });
    const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });
    const res = await post(ghost, s.id, { status: 'processing', message: 'should not persist' });
    assert.equal(res.status, 500);
    await assertNothingWritten(s.id, 'pending');
  });

  test('stale expectedStatus and a locked row are both 409 with nothing written', async () => {
    const { token } = await asAdmin('manager');
    const s = await insertShipment((await insertCustomer()).id, { status: 'processing' });
    assert.equal((await post(token, s.id, { status: 'in_transit', expectedStatus: 'pending' })).status, 409);

    const other = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT id FROM shipments WHERE id = $1 FOR UPDATE', [s.id]);
      assert.equal((await post(token, s.id, { message: 'note while locked' })).status, 409);
    } finally {
      await other.query('ROLLBACK');
      await other.end();
    }
    await assertNothingWritten(s.id, 'processing');
  });

  test('support_staff is still blocked by the existing read-only rule', async () => {
    const { token } = await asAdmin('support_staff');
    const s = await insertShipment((await insertCustomer()).id, { status: 'pending' });
    assert.equal((await post(token, s.id, { message: 'x' })).status, 403);
    await assertNothingWritten(s.id, 'pending');
  });
});
