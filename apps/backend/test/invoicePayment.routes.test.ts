import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { Client } from 'pg';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin, insertCustomer, insertInvoice } from './helpers/fixtures';
import pool from '../src/config/db';
import invoicesRoutes from '../src/modules/invoices/invoices.routes';

describe('PUT /api/admin/invoices/:id/payment', dbTest, () => {
  let app: TestApp;
  let token: string;

  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/admin/invoices', invoicesRoutes]]);
  });
  beforeEach(async () => {
    await truncateAll();
    const admin = await insertAdmin({ assignedRoles: ['finance_officer'] });
    token = adminToken({ id: admin.id, email: admin.email, activeRole: 'finance_officer' });
  });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const pay = (id: string, body: object) => request(app, 'PUT', `/api/admin/invoices/${id}/payment`, { token, body });
  const invoiceState = async (id: string) => {
    const inv = (await pool.query('SELECT status FROM invoices WHERE id = $1', [id])).rows[0];
    const p = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount) FILTER (WHERE payment_status = 'success'), 0)::text AS total
         FROM payments WHERE invoice_id = $1`,
      [id]
    );
    return { status: inv.status, payments: p.rows[0].n, total: p.rows[0].total };
  };
  const newInvoice = async (amount: string, status = 'sent') => insertInvoice((await insertCustomer()).id, { amount, status });

  test('full payment marks paid, sets paid_at, returns decimal strings, audits the settlement', async () => {
    const inv = await newInvoice('100.00');
    const res = await pay(inv.id, { amount: 100, paymentMethod: 'manual', notes: 'bank transfer' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'paid');
    assert.equal(res.body.data.amountPaid, '100.00');
    assert.equal(res.body.data.outstanding, '0.00');
    assert.deepEqual(await invoiceState(inv.id), { status: 'paid', payments: 1, total: '100.00' });

    const payment = (await pool.query('SELECT amount::text, payment_status, payment_method, paid_at, currency FROM payments WHERE invoice_id = $1', [inv.id])).rows[0];
    assert.equal(payment.amount, '100.00');
    assert.equal(payment.payment_status, 'success');
    assert.equal(payment.payment_method, 'manual');
    assert.ok(payment.paid_at instanceof Date);

    const audit = (await pool.query(`SELECT metadata FROM audit_logs WHERE resource_id = $1 AND action = 'RECORD_INVOICE_PAYMENT'`, [inv.id])).rows[0].metadata;
    assert.deepEqual(
      [audit.amount, audit.previousStatus, audit.newStatus, audit.paidTotal, audit.outstanding],
      ['100', 'sent', 'paid', '100.00', '0.00']
    );
  });

  test('partial payment → part_paid; the remainder → paid', async () => {
    const inv = await newInvoice('100.00');
    const first = await pay(inv.id, { amount: '40', paymentMethod: 'manual' });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.status, 'part_paid');
    assert.equal(first.body.data.outstanding, '60.00');
    const second = await pay(inv.id, { amount: 60, paymentMethod: 'stripe' });
    assert.equal(second.body.data.status, 'paid');
    assert.deepEqual(await invoiceState(inv.id), { status: 'paid', payments: 2, total: '100.00' });
  });

  test('money math is exact (no JS float drift)', async () => {
    const small = await newInvoice('0.30');
    assert.equal((await pay(small.id, { amount: 0.1, paymentMethod: 'manual' })).body.data.status, 'part_paid');
    const res = await pay(small.id, { amount: 0.2, paymentMethod: 'manual' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'paid');
    assert.equal(res.body.data.outstanding, '0.00');

    const thirds = await newInvoice('100.00');
    for (const amount of ['33.33', '33.33']) assert.equal((await pay(thirds.id, { amount, paymentMethod: 'manual' })).body.data.status, 'part_paid');
    assert.equal((await pay(thirds.id, { amount: '33.34', paymentMethod: 'manual' })).body.data.status, 'paid');

    const big = await newInvoice('9999999999999.99');
    const r = await pay(big.id, { amount: '9999999999999.98', paymentMethod: 'manual' });
    assert.equal(r.body.data.outstanding, '0.01');
    assert.equal(r.body.data.status, 'part_paid');
  });

  test('overpayment is 400 with the outstanding balance and writes nothing', async () => {
    const inv = await newInvoice('100.00');
    const over = await pay(inv.id, { amount: '100.01', paymentMethod: 'manual' });
    assert.equal(over.status, 400);
    assert.equal(over.body.outstanding, '100.00');
    assert.deepEqual(await invoiceState(inv.id), { status: 'sent', payments: 0, total: '0' });

    await pay(inv.id, { amount: '40.00', paymentMethod: 'manual' });
    const over2 = await pay(inv.id, { amount: '60.01', paymentMethod: 'manual' });
    assert.equal(over2.status, 400);
    assert.equal(over2.body.outstanding, '60.00');
    assert.deepEqual(await invoiceState(inv.id), { status: 'part_paid', payments: 1, total: '40.00' });
  });

  test('invalid amounts and methods are 400 and write nothing', async () => {
    const inv = await newInvoice('100.00');
    const bad = [0, '0', '0.00', -5, '-5', '10.001', 'abc', '', null, '1e3', 1e21, '12345678901234', ' ', [], {}, true];
    for (const amount of bad) {
      assert.equal((await pay(inv.id, { amount, paymentMethod: 'manual' })).status, 400, `amount=${JSON.stringify(amount)}`);
    }
    for (const paymentMethod of [undefined, 'cash', '', 'MANUAL']) {
      assert.equal((await pay(inv.id, { amount: 10, paymentMethod })).status, 400, `method=${paymentMethod}`);
    }
    assert.deepEqual(await invoiceState(inv.id), { status: 'sent', payments: 0, total: '0' });
  });

  test('already-paid invoice is 409; unknown or malformed id is 404', async () => {
    const paid = await newInvoice('50.00', 'paid');
    assert.equal((await pay(paid.id, { amount: 1, paymentMethod: 'manual' })).status, 409);
    assert.equal((await invoiceState(paid.id)).payments, 0);
    assert.equal((await pay(crypto.randomUUID(), { amount: 1, paymentMethod: 'manual' })).status, 404);
    assert.equal((await pay('INV-001', { amount: 1, paymentMethod: 'manual' })).status, 404);
  });

  test('pending/failed payments do not count toward the balance', async () => {
    const inv = await newInvoice('100.00');
    await pool.query(
      `INSERT INTO payments (invoice_id, customer_id, amount, currency, payment_method, payment_status)
       VALUES ($1, $2, 100, 'NGN', 'paystack', 'failed'), ($1, $2, 100, 'NGN', 'stripe', 'pending')`,
      [inv.id, inv.customer_id]
    );
    const res = await pay(inv.id, { amount: 100, paymentMethod: 'manual' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'paid');
    assert.equal(res.body.data.amountPaid, '100.00');
  });

  test('a payment waits for a concurrent payment on the same invoice, then sees its amount (no overpay)', async () => {
    const inv = await newInvoice('100.00');
    const other = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await other.connect();
    let pending: Promise<any> | undefined;
    try {
      // Another transaction holds the invoice lock and has an uncommitted 60.00 payment.
      await other.query('BEGIN');
      await other.query('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', [inv.id]);
      await other.query(
        `INSERT INTO payments (invoice_id, customer_id, amount, currency, payment_method, payment_status) VALUES ($1, $2, 60, 'NGN', 'manual', 'success')`,
        [inv.id, inv.customer_id]
      );

      pending = pay(inv.id, { amount: 60, paymentMethod: 'manual' });

      // Prove the request is blocked on the row lock before releasing it.
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const { rows } = await pool.query(
          `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT * FROM invoices WHERE id = $1 FOR UPDATE%'`
        );
        waiting = rows.length > 0;
        if (!waiting) await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(waiting, 'payment request should be waiting on the invoice lock');
      await other.query('COMMIT');
    } finally {
      await other.query('ROLLBACK').catch(() => {});
      await other.end();
    }

    const res = await pending!;
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.outstanding, '40.00');
    assert.deepEqual(await invoiceState(inv.id), { status: 'sent', payments: 1, total: '60.00' });
  });

  test('two simultaneous payments that together overpay: one succeeds, one is rejected', async () => {
    const inv = await newInvoice('100.00');
    const results = await Promise.all([
      pay(inv.id, { amount: 60, paymentMethod: 'manual' }),
      pay(inv.id, { amount: 60, paymentMethod: 'manual' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.deepEqual(await invoiceState(inv.id), { status: 'part_paid', payments: 1, total: '60.00' });
  });

  test('legacy row already marked paid with a shortfall still gets 409 (no backfill; see docs/sql review query)', async () => {
    const inv = await newInvoice('100.00', 'paid');
    await pool.query(
      `INSERT INTO payments (invoice_id, customer_id, amount, currency, payment_method, payment_status) VALUES ($1, $2, 40, 'NGN', 'manual', 'success')`,
      [inv.id, inv.customer_id]
    );
    assert.equal((await pay(inv.id, { amount: 60, paymentMethod: 'manual' })).status, 409);
  });
});
