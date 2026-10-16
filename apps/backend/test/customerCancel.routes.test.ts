import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, customerToken, insertAdmin, insertCustomer, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import shipmentsRoutes from '../src/modules/shipments/shipments.routes';
import clientShipmentsRoutes from '../src/modules/client/client.shipments.routes';
import clientCargoRoutes from '../src/modules/client/client.cargo.routes';
import { MAX_CANCEL_REASON_LENGTH, parseCancelReason } from '../src/utils/cancelReason';

const NON_PENDING = ['draft', 'processing', 'in_transit', 'clearance', 'delivered', 'cancelled'];
const HTML = '<img src=x onerror=alert(1)><script>alert("x")</script> & "quotes"';

describe('parseCancelReason', () => {
  const ok = (body: unknown) => {
    const r = parseCancelReason(body);
    assert.ok(r.ok, JSON.stringify(r));
    return r.ok ? r.reason : null;
  };
  const bad = (body: unknown) => assert.equal(parseCancelReason(body).ok, false, JSON.stringify(body));

  test('missing, empty and whitespace-only reasons are null; text is trimmed and cleaned', () => {
    for (const body of [undefined, null, {}, { reason: null }, { reason: '' }, { reason: '   \n\t ' }, 'text', []]) assert.equal(ok(body), null, JSON.stringify(body));
    assert.equal(ok({ reason: '  Found a cheaper option  ' }), 'Found a cheaper option');
    assert.equal(ok({ reason: 'a\r\nb\rc' }), 'a\nb\nc');
    assert.equal(ok({ reason: 'a\tb\u0000c\u001bd' }), 'a b c d');
    assert.equal(ok({ reason: 'line 1\nline 2' }), 'line 1\nline 2');
  });

  test('limit: 500 characters by code point; non-text values are rejected', () => {
    assert.equal(ok({ reason: 'x'.repeat(MAX_CANCEL_REASON_LENGTH) })!.length, 500);
    bad({ reason: 'x'.repeat(501) });
    assert.equal([...ok({ reason: '😀'.repeat(500) })!].length, 500, 'an emoji is one character');
    bad({ reason: '😀'.repeat(501) });
    for (const reason of [5, true, {}, ['a'], { toString: 'x' }]) bad({ reason });
  });
});

describe('customer cancel and edit rules, reason, notification, admin detail', dbTest, () => {
  let app: TestApp;

  before(async () => {
    await resetDatabase();
    app = await startApp([
      ['/api/admin/shipments', shipmentsRoutes],
      ['/api/client/shipments', clientShipmentsRoutes],
      ['/api/client/cargo-clearings', clientCargoRoutes],
    ]);
  });
  beforeEach(async () => { await truncateAll(); });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const statusOf = async (id: string) => (await pool.query('SELECT status FROM shipments WHERE id = $1', [id])).rows[0].status;
  const cancel = (c: any, orderId: string, body?: unknown) =>
    request(app, 'DELETE', `/api/client/shipments/${encodeURIComponent(orderId)}`, { token: customerToken(c), body });
  const insertClearing = async (customerId: string, status: string) =>
    (await pool.query(
      `INSERT INTO cargo_clearings (customer_id, clearing_type, description, status) VALUES ($1, 'air_clearing', 'Spare parts', $2) RETURNING id`,
      [customerId, status])).rows[0].id as string;
  const clearingStatus = async (id: string) => (await pool.query('SELECT status, description FROM cargo_clearings WHERE id = $1', [id])).rows[0];
  const asAdmin = async (role: string) => {
    const a = await insertAdmin({ assignedRoles: [role] });
    return adminToken({ id: a.id, email: a.email, activeRole: role });
  };

  describe('shipments: customers cancel and edit ONLY while pending', () => {
    test('edit (PUT) is refused with 403 for every non-pending status and changes nothing; pending is allowed', async () => {
      const c = await insertCustomer();
      const token = customerToken(c);
      for (const status of NON_PENDING) {
        const s = await insertShipment(c.id, { status });
        const res = await request(app, 'PUT', `/api/client/shipments/${encodeURIComponent(s.order_id)}`, { token, body: { natureOfItem: 'Changed' } });
        assert.equal(res.status, 403, status);
        assert.equal(res.body.message, 'Shipment cannot be modified after processing has begun');
        assert.equal(await statusOf(s.id), status);
        assert.notEqual((await pool.query('SELECT nature_of_item FROM shipments WHERE id = $1', [s.id])).rows[0].nature_of_item, 'Changed', status);
      }
      const pending = await insertShipment(c.id, { status: 'pending' });
      const ok = await request(app, 'PUT', `/api/client/shipments/${encodeURIComponent(pending.order_id)}`, { token, body: { natureOfItem: 'Changed' } });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    });

    test('cancel (DELETE) is refused with 403 for every non-pending status, also with a reason', async () => {
      const c = await insertCustomer();
      for (const status of NON_PENDING) {
        const s = await insertShipment(c.id, { status });
        const res = await cancel(c, s.order_id, { reason: 'please' });
        assert.equal(res.status, 403, status);
        assert.equal(await statusOf(s.id), status);
        assert.equal((await pool.query(`SELECT 1 FROM audit_logs WHERE resource_id = $1`, [s.id])).rowCount, 0, `${status}: no audit row`);
      }
    });

    test('a customer cannot cancel or edit another customer\'s shipment (404)', async () => {
      const c = await insertCustomer();
      const other = await insertCustomer();
      const theirs = await insertShipment(other.id, { status: 'pending' });
      assert.equal((await cancel(c, theirs.order_id, { reason: 'x' })).status, 404);
      assert.equal((await request(app, 'PUT', `/api/client/shipments/${encodeURIComponent(theirs.order_id)}`, { token: customerToken(c), body: { natureOfItem: 'x' } })).status, 404);
      assert.equal(await statusOf(theirs.id), 'pending');
    });
  });

  describe('cargo clearings: customers cancel and edit ONLY while pending', () => {
    test('edit and cancel are refused with 403 for any non-pending status; pending edit and cancel work', async () => {
      const c = await insertCustomer();
      const token = customerToken(c);
      for (const status of ['processing', 'in_transit', 'clearance', 'completed', 'delivered', 'cancelled', 'draft']) {
        const id = await insertClearing(c.id, status);
        const put = await request(app, 'PUT', `/api/client/cargo-clearings/${id}`, { token, body: { description: 'Changed' } });
        assert.equal(put.status, 403, `PUT ${status}`);
        assert.equal(put.body.message, 'Cargo clearing cannot be modified after processing has begun');
        const del = await request(app, 'DELETE', `/api/client/cargo-clearings/${id}`, { token });
        assert.equal(del.status, 403, `DELETE ${status}`);
        assert.deepEqual(await clearingStatus(id), { status, description: 'Spare parts' });
      }
      const pending = await insertClearing(c.id, 'pending');
      const put = await request(app, 'PUT', `/api/client/cargo-clearings/${pending}`, { token, body: { description: 'Changed' } });
      assert.equal(put.status, 200, JSON.stringify(put.body));
      const del = await request(app, 'DELETE', `/api/client/cargo-clearings/${pending}`, { token });
      assert.equal(del.status, 200);
      assert.equal((await clearingStatus(pending)).status, 'cancelled');
    });

    test('another customer\'s clearing is a 404', async () => {
      const c = await insertCustomer();
      const other = await insertCustomer();
      const id = await insertClearing(other.id, 'pending');
      assert.equal((await request(app, 'DELETE', `/api/client/cargo-clearings/${id}`, { token: customerToken(c) })).status, 404);
      assert.equal((await request(app, 'PUT', `/api/client/cargo-clearings/${id}`, { token: customerToken(c), body: { description: 'x' } })).status, 404);
      assert.equal((await clearingStatus(id)).status, 'pending');
    });
  });

  describe('the optional reason', () => {
    test('no body still cancels exactly as before; the audit row has reason null', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await cancel(c, s.order_id)).status, 200);
      assert.equal(await statusOf(s.id), 'cancelled');
      const audit = (await pool.query(`SELECT metadata FROM audit_logs WHERE resource_id = $1 AND action = 'CANCEL_SHIPMENT'`, [s.id])).rows[0].metadata;
      assert.deepEqual([audit.from, audit.to, audit.reason], ['pending', 'cancelled', null]);
    });

    test('invalid reasons are 400 and change nothing: too long, not text', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      for (const reason of ['x'.repeat(501), 42, true, { a: 1 }, ['x']]) {
        const res = await cancel(c, s.order_id, { reason });
        assert.equal(res.status, 400, JSON.stringify(reason).slice(0, 30));
        assert.equal(res.body.success, false);
      }
      assert.equal(await statusOf(s.id), 'pending');
      assert.equal((await pool.query(`SELECT 1 FROM audit_logs WHERE resource_id = $1`, [s.id])).rowCount, 0);
    });

    test('a valid reason is trimmed and stored in full in the audit metadata; whitespace-only is stored as null', async () => {
      const c = await insertCustomer();
      const long = 'ab'.repeat(250);
      const a = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await cancel(c, a.order_id, { reason: `  ${long}  ` })).status, 200);
      const audit = (await pool.query(`SELECT metadata FROM audit_logs WHERE resource_id = $1`, [a.id])).rows[0].metadata;
      assert.equal(audit.reason, long);
      assert.equal(audit.reason.length, 500);

      const b = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await cancel(c, b.order_id, { reason: '   ' })).status, 200);
      assert.equal((await pool.query(`SELECT metadata FROM audit_logs WHERE resource_id = $1`, [b.id])).rows[0].metadata.reason, null);
    });

    test('HTML in a reason is stored and passed on as literal text', async () => {
      await insertAdmin({ assignedRoles: ['super_admin'] });
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await cancel(c, s.order_id, { reason: HTML })).status, 200);
      const audit = (await pool.query(`SELECT metadata FROM audit_logs WHERE resource_id = $1`, [s.id])).rows[0].metadata;
      assert.equal(audit.reason, HTML);
      const note = (await pool.query(`SELECT body, title FROM notifications WHERE dedupe_key LIKE 'shipment.cancelled_by_client:%' LIMIT 1`)).rows[0];
      assert.ok(note.body.includes(HTML), note.body);
    });

    test('the admin notification carries the reason: short as typed, long cut at 200 characters', async () => {
      await insertAdmin({ assignedRoles: ['super_admin'] });
      const c = await insertCustomer();
      const short = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await cancel(c, short.order_id, { reason: 'Found a cheaper option' })).status, 200);
      const bodies = async () => (await pool.query(`SELECT body FROM notifications WHERE dedupe_key LIKE 'shipment.cancelled_by_client:%' ORDER BY id`)).rows.map((r) => r.body as string);
      assert.equal((await bodies())[0], 'Test Customer cancelled this pending shipment. Reason: Found a cheaper option');

      const long = await insertShipment(c.id, { status: 'pending' });
      const text = 'w'.repeat(500);
      assert.equal((await cancel(c, long.order_id, { reason: text })).status, 200);
      const second = (await bodies())[1];
      assert.equal(second, `Test Customer cancelled this pending shipment. Reason: ${'w'.repeat(200)}…`);
      assert.equal((await pool.query(`SELECT metadata FROM audit_logs WHERE resource_id = $1`, [long.id])).rows[0].metadata.reason, text, 'the audit row keeps all of it');

      const none = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await cancel(c, none.order_id)).status, 200);
      assert.equal((await bodies())[2], 'Test Customer cancelled this pending shipment.');
    });

    test('there is no email for this event (in-app only), so the reason never enters an email', async () => {
      await insertAdmin({ assignedRoles: ['super_admin'] });
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      await cancel(c, s.order_id, { reason: HTML });
      assert.equal((await pool.query(`SELECT 1 FROM email_deliveries WHERE params::text LIKE '%onerror%'`)).rowCount, 0);
    });
  });

  describe('admin shipment detail: "Cancelled by the customer"', () => {
    const detail = (token: string, id: string) => request(app, 'GET', `/api/admin/shipments/${id}`, { token });

    test('shows the full 500-character reason, a date in APP_TIMEZONE, and the ISO instant', async () => {
      const token = await asAdmin('logistics_officer');
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      const full = 'Reason-'.repeat(80).slice(0, 500);
      assert.equal((await cancel(c, s.order_id, { reason: full })).status, 200);
      const res = await detail(token, s.id);
      assert.equal(res.status, 200);
      const cc = res.body.data.customerCancellation;
      assert.equal(cc.reason, full);
      assert.equal(cc.reason.length, 500);
      assert.match(cc.atText, /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} [A-Z]{2,5}$/);
      assert.ok(Math.abs(Date.now() - new Date(cc.at).getTime()) < 60_000);
    });

    test('an HTML payload comes back literally (the UI renders it as text)', async () => {
      const token = await asAdmin('manager');
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      await cancel(c, s.order_id, { reason: HTML });
      assert.equal((await detail(token, s.id)).body.data.customerCancellation.reason, HTML);
    });

    test('no reason given: reason is null (the UI says "No reason given")', async () => {
      const token = await asAdmin('super_admin');
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      await cancel(c, s.order_id);
      const cc = (await detail(token, s.id)).body.data.customerCancellation;
      assert.equal(cc.reason, null);
      assert.ok(cc.atText);
    });

    test('null when the shipment is not cancelled, or was cancelled by VHI, or reopened and cancelled again by VHI', async () => {
      const token = await asAdmin('super_admin');
      const c = await insertCustomer();
      const pending = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await detail(token, pending.id)).body.data.customerCancellation, null);

      const byAdmin = await insertShipment(c.id, { status: 'pending' });
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${byAdmin.id}/status`, { token, body: { status: 'cancelled', reason: 'Duplicate order' } })).status, 200);
      assert.equal((await detail(token, byAdmin.id)).body.data.customerCancellation, null);

      const reopened = await insertShipment(c.id, { status: 'pending' });
      await cancel(c, reopened.order_id, { reason: 'Customer reason' });
      assert.equal((await detail(token, reopened.id)).body.data.customerCancellation.reason, 'Customer reason');
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${reopened.id}/status`, { token, body: { status: 'pending', reason: 'Customer asked again' } })).status, 200);
      assert.equal((await detail(token, reopened.id)).body.data.customerCancellation, null, 'pending again');
      await new Promise((r) => setTimeout(r, 15));
      assert.equal((await request(app, 'PUT', `/api/admin/shipments/${reopened.id}/status`, { token, body: { status: 'cancelled', reason: 'Out of stock' } })).status, 200);
      assert.equal((await detail(token, reopened.id)).body.data.customerCancellation, null, 'the new cancellation is VHI\'s, not the customer\'s');
    });

    test('gated like the rest of shipment detail: no shipments module, no access', async () => {
      const c = await insertCustomer();
      const s = await insertShipment(c.id, { status: 'pending' });
      await cancel(c, s.order_id, { reason: 'secret reason' });
      const crm = await asAdmin('crm_officer');
      const res = await detail(crm, s.id);
      assert.equal(res.status, 403);
      assert.doesNotMatch(JSON.stringify(res.body), /secret reason/);
      assert.equal((await request(app, 'GET', `/api/admin/shipments/${s.id}`, { token: customerToken(c) })).status, 401);
    });
  });
});
