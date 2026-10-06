import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, customerToken, insertAdmin, insertCustomer, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import { emit } from '../src/modules/notifications/notification.service';
import type { NotificationEvent } from '../src/modules/notifications/events';
import shipmentsRoutes from '../src/modules/shipments/shipments.routes';
import clientShipmentsRoutes from '../src/modules/client/client.shipments.routes';
import { adminTrackingRoutes } from '../src/modules/tracking/tracking.routes';
import clientTrackingRoutes from '../src/modules/client/client.tracking.routes';
import communicationsRoutes from '../src/modules/communications/communications.routes';
import clientCommunicationsRoutes from '../src/modules/client/client.communications.routes';

// Resend calls go through global fetch: count them and never hit the network. Other fetches pass through.
const realFetch = globalThis.fetch;
let resendCalls = 0;
mock.method(globalThis, 'fetch', async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url.includes('resend')) {
    resendCalls++;
    return new Response(JSON.stringify({ id: 'email_test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
});
const settle = () => new Promise((r) => setTimeout(r, 100));

interface Row {
  admin_id: string | null;
  customer_id: string | null;
  type: string;
  module: string | null;
  title: string;
  body: string;
  data: any;
  dedupe_key: string;
  read_at: Date | null;
  actor_type: string;
}

describe('notification events', dbTest, () => {
  let app: TestApp;
  const A: Record<string, any> = {};
  const tok: Record<string, string> = {};

  before(async () => {
    await resetDatabase();
    app = await startApp([
      ['/api/admin/shipments', shipmentsRoutes],
      ['/api/client/shipments', clientShipmentsRoutes],
      ['/api/admin/tracking', adminTrackingRoutes],
      ['/api/client/tracking', clientTrackingRoutes],
      ['/api/admin/communications', communicationsRoutes],
      ['/api/client/communications', clientCommunicationsRoutes],
    ]);
  });

  beforeEach(async () => {
    await truncateAll();
    clearAdminAccountCache();
    resendCalls = 0;
    for (const role of ['super_admin', 'manager', 'logistics_officer', 'finance_officer', 'crm_officer', 'support_staff']) {
      A[role] = await insertAdmin({ assignedRoles: [role] });
      tok[role] = adminToken({ id: A[role].id, email: A[role].email, activeRole: role });
    }
    A.inactive = await insertAdmin({ assignedRoles: ['manager'], isActive: false });
    A.deleted = await insertAdmin({ assignedRoles: ['logistics_officer'], deleted: true });
  });

  after(async () => {
    await app?.close();
    await pool.end();
  });

  const rows = async (): Promise<Row[]> =>
    (await pool.query('SELECT admin_id, customer_id, type, module, title, body, data, dedupe_key, read_at, actor_type FROM notifications ORDER BY id')).rows;
  const adminRecipients = (rs: Row[]) => rs.filter((r) => r.admin_id).map((r) => r.admin_id).sort();
  const ids = (...roles: string[]) => roles.map((r) => A[r].id).sort();

  async function emitInTx(event: NotificationEvent, finish: 'COMMIT' | 'ROLLBACK' = 'COMMIT') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const n = await emit(event, client);
      await client.query(finish);
      return n;
    } finally {
      client.release();
    }
  }

  async function withCommitFailure<T>(fn: () => Promise<T>): Promise<T> {
    await pool.query(`CREATE OR REPLACE FUNCTION test_fail_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced failure at commit'; END $$`);
    await pool.query(`CREATE CONSTRAINT TRIGGER test_fail_at_commit AFTER INSERT ON notifications
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_fail_at_commit()`);
    try {
      return await fn();
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS test_fail_at_commit ON notifications');
      await pool.query('DROP FUNCTION IF EXISTS test_fail_at_commit()');
    }
  }

  describe('recipient resolution', () => {
    test('shipment.created → active, non-deleted super_admin/manager/logistics_officer only; module shipments', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id);
      await emitInTx({ type: 'shipment.created', actor: { type: 'customer', id: c.id }, sourceId: s.id, shipment: { id: s.id, orderId: s.order_id, customerId: c.id, shippingMode: 'air_freight' } });
      const rs = await rows();
      assert.deepEqual(adminRecipients(rs), ids('super_admin', 'manager', 'logistics_officer'));
      assert.ok(rs.every((r) => r.module === 'shipments' && r.customer_id === null && r.actor_type === 'customer'));
      assert.ok(rs.every((r) => r.dedupe_key === `shipment.created:${s.id}`));
    });

    test('message.received to admins → every active role with communications', async () => {
      const c = await insertCustomer();
      await emitInTx({ type: 'message.received', actor: { type: 'customer', id: c.id }, sourceId: c.id, customerId: c.id, direction: 'to_admins', text: 'hi' });
      assert.deepEqual(adminRecipients(await rows()), ids('super_admin', 'manager', 'logistics_officer', 'crm_officer', 'support_staff'));
    });

    test('the acting admin is excluded; a customer acting on their own entity gets nothing', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id);
      await emitInTx({ type: 'shipment.created', actor: { type: 'admin', id: A.manager.id }, sourceId: s.id, shipment: { id: s.id, orderId: s.order_id, customerId: c.id, shippingMode: 'sea_freight' } });
      assert.deepEqual(adminRecipients(await rows()), ids('super_admin', 'logistics_officer'));

      await truncateAll();
      const c2 = await insertCustomer();
      const s2 = await insertShipment(c2.id);
      const n = await emitInTx({ type: 'shipment.created_for_customer', actor: { type: 'customer', id: c2.id }, sourceId: s2.id, shipment: { id: s2.id, orderId: s2.order_id, customerId: c2.id, status: 'pending' } });
      assert.equal(n, 0);
    });

    test('an admin whose role is later added or removed is resolved from the DB at emit time', async () => {
      await pool.query(`UPDATE admins SET assigned_roles = ARRAY['finance_officer','logistics_officer'] WHERE id = $1`, [A.finance_officer.id]);
      await pool.query(`UPDATE admins SET assigned_roles = ARRAY['crm_officer'] WHERE id = $1`, [A.logistics_officer.id]);
      const c = await insertCustomer();
      const s = await insertShipment(c.id);
      await emitInTx({ type: 'shipment.created', actor: { type: 'customer', id: c.id }, sourceId: s.id, shipment: { id: s.id, orderId: s.order_id, customerId: c.id, shippingMode: 'air_freight' } });
      assert.deepEqual(adminRecipients(await rows()), ids('super_admin', 'manager', 'finance_officer'));
    });
  });

  describe('dedupe and rollback', () => {
    test('same source row twice → one row per recipient; a new source row → new rows', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id);
      const ev = (sourceId: string): NotificationEvent => ({
        type: 'shipment.status_changed', actor: { type: 'admin', id: A.manager.id }, sourceId,
        shipment: { id: s.id, orderId: s.order_id, customerId: c.id }, from: 'pending', to: 'processing', reason: null, isCorrection: false, isReopen: false,
      });
      assert.equal(await emitInTx(ev('11111111-1111-1111-1111-111111111111')), 1);
      assert.equal(await emitInTx(ev('11111111-1111-1111-1111-111111111111')), 0);
      assert.equal(await emitInTx(ev('22222222-2222-2222-2222-222222222222')), 1);
      assert.equal((await rows()).length, 2);
    });

    test('same message row twice does not bump the grouped count', async () => {
      const c = await insertCustomer();
      const ev: NotificationEvent = { type: 'message.received', actor: { type: 'admin', id: A.manager.id }, sourceId: '33333333-3333-3333-3333-333333333333', customerId: c.id, direction: 'to_customer', text: 'hi' };
      await emitInTx(ev);
      await emitInTx(ev);
      const rs = await rows();
      assert.equal(rs.length, 1);
      assert.equal(rs[0].data.count, 1);
    });

    test('rolling back the caller transaction leaves zero notifications', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id);
      const n = await emitInTx({ type: 'shipment.created', actor: { type: 'customer', id: c.id }, sourceId: s.id, shipment: { id: s.id, orderId: s.order_id, customerId: c.id, shippingMode: 'air_freight' } }, 'ROLLBACK');
      assert.equal(n, 3);
      assert.equal((await rows()).length, 0);
    });

    test('route: a failure after emit (at COMMIT) leaves zero notifications and an unchanged status', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      const res = await withCommitFailure(() =>
        request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token: tok.manager, body: { status: 'processing' } })
      );
      assert.equal(res.status, 500);
      assert.equal((await rows()).length, 0);
      assert.equal((await pool.query('SELECT status FROM shipments WHERE id = $1', [s.id])).rows[0].status, 'pending');
      assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'UPDATE_SHIPMENT_STATUS'`)).rows[0].n, 0, 'audit rolled back too');
    });
  });

  describe('shipment.status_changed via routes', () => {
    const put = (id: string, body: object, role = 'manager') => request(app, 'PUT', `/api/admin/shipments/${id}/status`, { token: tok[role], body });

    test('forward moves notify; a correction does not; repeating a transition notifies again', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await put(s.id, { status: 'processing' })).status, 200);
      assert.equal((await put(s.id, { status: 'pending', reason: 'Wrong shipment' })).status, 200); // correction
      assert.equal((await put(s.id, { status: 'processing' })).status, 200);
      const rs = (await rows()).filter((r) => r.customer_id === c.id);
      assert.deepEqual(rs.map((r) => r.title), [`Shipment ${s.order_id} is being processed`, `Shipment ${s.order_id} is being processed`]);
      assert.notEqual(rs[0].dedupe_key, rs[1].dedupe_key);
      assert.ok(rs.every((r) => r.module === null && r.type === 'shipment.status_changed'));
    });

    test('admin cancel shows the reason; reopen (cancelled→pending) notifies; delivered reopen (correction) does not', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'processing' });
      assert.equal((await put(s.id, { status: 'cancelled', reason: 'Goods refused at origin' })).status, 200);
      assert.equal((await put(s.id, { status: 'pending', reason: 'Customer re-confirmed' })).status, 200);
      const d = await insertShipment(c.id, { status: 'delivered' });
      assert.equal((await put(d.id, { status: 'in_transit', reason: 'Marked delivered by mistake' })).status, 200);

      const rs = await rows();
      assert.deepEqual(rs.map((r) => [r.title, r.body]), [
        [`Shipment ${s.order_id} was cancelled`, 'Reason: Goods refused at origin'],
        [`Shipment ${s.order_id} is active again`, 'Your shipment has been reopened and is pending.'],
      ]);
    });

    test('draft→pending (same customer label) does not notify', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'draft' });
      assert.equal((await put(s.id, { status: 'pending' })).status, 200);
      assert.equal((await rows()).length, 0);
    });

    test('tracking-route transitions notify the same way; note-only updates do not notify', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'in_transit' });
      const post = (body: object) => request(app, 'POST', `/api/admin/tracking/${s.id}/update`, { token: tok.logistics_officer, body });
      assert.equal((await post({ status: 'clearance', message: 'At port' })).status, 200);
      assert.equal((await post({ message: 'Docs received' })).status, 200);
      const rs = await rows();
      assert.deepEqual(rs.map((r) => r.title), [`Shipment ${s.order_id} is in customs clearance`]);
    });
  });

  describe('shipment.tracking_assigned', () => {
    const put = (id: string, body: object) => request(app, 'PUT', `/api/admin/shipments/${id}/tracking`, { token: tok.logistics_officer, body });

    test('only the empty→set transition notifies, with the new number', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id);
      assert.equal((await put(s.id, { awbNumber: '  ' })).status, 200, 'blank stays empty');
      assert.equal((await put(s.id, { uniqueId: 'U-1' })).status, 200, 'unique id alone does not notify');
      assert.equal((await put(s.id, { awbNumber: '176-12345675' })).status, 200);
      assert.equal((await put(s.id, { awbNumber: '176-99999999' })).status, 200, 'editing an existing AWB does not notify');
      assert.equal((await put(s.id, { bolNumber: 'MSCU1234567' })).status, 200);
      const rs = await rows();
      assert.deepEqual(rs.map((r) => r.body), ['Tracking number: 176-12345675', 'Tracking number: MSCU1234567']);
      assert.ok(rs.every((r) => r.customer_id === c.id && r.title === `Tracking number added for ${s.order_id}`));
    });

    test('both set at once → one notification listing both; no fields → 400', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id);
      assert.equal((await put(s.id, { awbNumber: 'A1', bolNumber: 'B1' })).status, 200);
      assert.deepEqual((await rows()).map((r) => r.body), ['Tracking numbers: A1, B1']);
      assert.equal((await put(s.id, {})).status, 400);
    });

    test('client tracking response exposes awbNumber/bolNumber to the owner only', async () => {
      const c = await insertCustomer();
      const other = await insertCustomer();
      const s = await insertShipment(c.id);
      await put(s.id, { awbNumber: 'A1', bolNumber: 'B1' });
      const mine = await request(app, 'GET', `/api/client/tracking/${s.order_id}`, { token: customerToken(c) });
      assert.equal(mine.status, 200);
      assert.deepEqual([mine.body.data.awbNumber, mine.body.data.bolNumber], ['A1', 'B1']);
      assert.equal((await request(app, 'GET', `/api/client/tracking/${s.order_id}`, { token: customerToken(other) })).status, 404);
    });
  });

  describe('shipment creation and client cancel', () => {
    test('admin create → shipment.created_for_customer to that customer (label shown)', async () => {
      const c = await insertCustomer();
      const res = await request(app, 'POST', '/api/admin/shipments', {
        token: tok.manager,
        body: { customerId: c.id, shippingMode: 'air_freight', natureOfItem: 'Parts', originAddress: 'A', destinationAddress: 'B', status: 'clearance' },
      });
      assert.equal(res.status, 201);
      const rs = await rows();
      assert.equal(rs.length, 1);
      assert.equal(rs[0].customer_id, c.id);
      assert.equal(rs[0].body, 'VHI created this shipment for you. Status: Customs clearance.');
      assert.equal(rs[0].dedupe_key, `shipment.created_for_customer:${res.body.data.id}`);
    });

    test('client create → shipment.created to operations staff', async () => {
      const c = await insertCustomer();
      const res = await request(app, 'POST', '/api/client/shipments', {
        token: customerToken(c),
        body: { shippingMode: 'sea_freight', deliveryMode: 'door_to_door', natureOfItem: 'Tiles', originAddress: 'A', destinationAddress: 'B' },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const rs = await rows();
      assert.deepEqual(adminRecipients(rs), ids('super_admin', 'manager', 'logistics_officer'));
      assert.equal(rs[0].body, 'Test Customer created a new Sea freight shipment.');
    });

    test('client cancel → shipment.cancelled_by_client to operations staff, keyed by the audit row', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await request(app, 'DELETE', `/api/client/shipments/${s.order_id}`, { token: customerToken(c) })).status, 200);
      const rs = await rows();
      assert.deepEqual(adminRecipients(rs), ids('super_admin', 'manager', 'logistics_officer'));
      const audit = (await pool.query(`SELECT id FROM audit_logs WHERE action = 'CANCEL_SHIPMENT'`)).rows[0];
      assert.ok(rs.every((r) => r.dedupe_key === `shipment.cancelled_by_client:${audit.id}`));
    });
  });

  describe('message.received grouping and email after commit', () => {
    const clientSend = (c: any, body: string) =>
      request(app, 'POST', '/api/client/communications/send', { token: customerToken(c), body: { subject: 'Support chat', body } });
    const adminSend = (c: any, body: string) =>
      request(app, 'POST', '/api/admin/communications/send', { token: tok.manager, body: { customerId: c.id, subject: 'Re', body } });

    test('3 customer messages → one unread row per communications admin with count 3 and the latest excerpt', async () => {
      const c = await insertCustomer();
      for (const b of ['first', 'second', 'third 👍🏽']) assert.equal((await clientSend(c, b)).status, 201);
      const rs = await rows();
      assert.deepEqual(adminRecipients(rs), ids('super_admin', 'manager', 'logistics_officer', 'crm_officer', 'support_staff'));
      for (const r of rs) {
        assert.equal(r.title, '3 new messages from Test Customer');
        assert.equal(r.body, 'third 👍🏽');
        assert.equal(r.data.count, 3);
        assert.equal(r.read_at, null);
      }
    });

    test('after an admin reads, their next message starts a new row; other admins keep grouping independently', async () => {
      const c = await insertCustomer();
      await clientSend(c, 'one');
      await clientSend(c, 'two');
      await pool.query(`UPDATE notifications SET read_at = NOW() WHERE admin_id = $1`, [A.manager.id]);
      await clientSend(c, 'three');

      const mgr = (await rows()).filter((r) => r.admin_id === A.manager.id);
      assert.equal(mgr.length, 2);
      assert.deepEqual(mgr.map((r) => r.data.count), [2, 1]);
      assert.ok(mgr[0].read_at !== null, 'read row untouched');
      assert.equal(mgr[1].title, 'New message from Test Customer');

      const crm = (await rows()).filter((r) => r.admin_id === A.crm_officer.id);
      assert.deepEqual(crm.map((r) => r.data.count), [3]);
    });

    test('admin → customer messages group as "N new messages from VHI Support"', async () => {
      const c = await insertCustomer();
      assert.equal((await adminSend(c, 'Hello')).status, 201);
      assert.equal((await adminSend(c, 'Your parcel ships today')).status, 201);
      const rs = (await rows()).filter((r) => r.customer_id === c.id);
      assert.equal(rs.length, 1);
      assert.deepEqual([rs[0].title, rs[0].body, rs[0].data.count], ['2 new messages from VHI Support', 'Your parcel ships today', 2]);
      assert.equal(rs[0].module, null);
    });

    test('email is sent only after COMMIT; a forced rollback sends nothing', async () => {
      process.env.SUPPORT_EMAIL = 'support@test.local';
      try {
        const c = await insertCustomer();
        assert.equal((await clientSend(c, 'committed')).status, 201);
        await settle();
        assert.equal(resendCalls, 1, 'support email after a committed client message');

        resendCalls = 0;
        const failedClient = await withCommitFailure(() => clientSend(c, 'rolled back'));
        const failedAdmin = await withCommitFailure(() => adminSend(c, 'rolled back'));
        await settle();
        assert.equal(failedClient.status, 500);
        assert.equal(failedAdmin.status, 500);
        assert.equal(resendCalls, 0, 'no email attempted for rolled-back messages');
        const kept = (await pool.query(`SELECT COUNT(*)::int AS n FROM communications WHERE body = 'rolled back'`)).rows[0].n;
        assert.equal(kept, 0, 'messages rolled back');
      } finally {
        delete process.env.SUPPORT_EMAIL;
      }
    });
  });
});
