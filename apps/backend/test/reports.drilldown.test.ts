import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin } from './helpers/fixtures';
import { OCT, seedReportData } from './helpers/reportsSeed';
import pool from '../src/config/db';
import reportsRoutes from '../src/modules/reports/reports.routes';
import shipmentsRoutes from '../src/modules/shipments/shipments.routes';
import invoicesRoutes from '../src/modules/invoices/invoices.routes';
import customersRoutes from '../src/modules/customers/customers.routes';

// The lists behind the report figures: every drill-down link carries the report's filters, and the list must hold exactly the
// rows the figure counted. Dataset and hand-worked answers: test/helpers/reportsSeed.ts.
const RANGE = 'createdFrom=2026-10-01&createdTo=2026-10-31';
const ISSUED = 'issuedFrom=2026-10-01&issuedTo=2026-10-31';
const PAID = 'paidFrom=2026-10-01&paidTo=2026-10-31';

describe('report drill-down lists', dbTest, () => {
  let app: TestApp;
  let finance: string;
  let support: string;
  let ids: Record<string, string>;

  before(async () => {
    await resetDatabase();
    app = await startApp([
      ['/api/admin/reports', reportsRoutes], ['/api/admin/shipments', shipmentsRoutes],
      ['/api/admin/invoices', invoicesRoutes], ['/api/admin/customers', customersRoutes],
    ]);
    await truncateAll();
    ids = await seedReportData();
    const f = await insertAdmin({ assignedRoles: ['finance_officer'] });
    finance = adminToken({ id: f.id, email: f.email, activeRole: 'finance_officer' });
    const s = await insertAdmin({ assignedRoles: ['support_staff'] });
    support = adminToken({ id: s.id, email: s.email, activeRole: 'support_staff' });
  });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const list = async (path: string, token = finance) => {
    const res = await request(app, 'GET', path, { token });
    assert.equal(res.status, 200, `${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const orderIds = (body: any) => body.data.map((r: any) => r.orderId).sort();
  const numbers = (body: any) => body.data.map((r: any) => r.invoiceNumber).sort();

  describe('shipments', () => {
    const S = (qs: string) => list(`/api/admin/shipments?pageSize=100&${qs}`);

    test('each shipment card opens the rows it counted', async () => {
      const summary = (await list(`/api/admin/reports/summary?${OCT}`)).data.shipments;
      const created = await S(`${RANGE}&excludeDraft=true`);
      assert.equal(created.pagination.total, summary.created);
      assert.deepEqual(orderIds(created), ['T-s10', 'T-s11', 'T-s2', 'T-s3', 'T-s5', 'T-s7', 'T-s8', 'T-s9']);

      const pending = await S(`${RANGE}&excludeDraft=true&status=pending`);
      assert.equal(pending.pagination.total, summary.pending);
      assert.deepEqual(orderIds(pending), ['T-s10', 'T-s11', 'T-s9']);

      const inProgress = await S(`${RANGE}&excludeDraft=true&statusGroup=in_progress`);
      assert.equal(inProgress.pagination.total, summary.inProgress);
      assert.deepEqual(orderIds(inProgress), ['T-s2', 'T-s7', 'T-s8']);

      // Completed / Cancelled are dated by when they got there, not by creation
      const completed = await S(`${RANGE}&status=delivered&dateField=status_changed`);
      assert.equal(completed.pagination.total, summary.completed);
      assert.deepEqual(orderIds(completed), ['T-s3', 'T-s4']);
      const cancelled = await S(`${RANGE}&status=cancelled&dateField=status_changed`);
      assert.deepEqual(orderIds(cancelled), ['T-s5']);
    });

    test('the other report filters carry over: customer, industry, mode; local-date boundaries', async () => {
      assert.deepEqual(orderIds(await S(`${RANGE}&excludeDraft=true&customerId=${ids.A}&mode=air_freight`)), ['T-s10', 'T-s11', 'T-s2', 'T-s7']);
      assert.deepEqual(orderIds(await S(`${RANGE}&excludeDraft=true&industry=mining`)), ['T-s3', 'T-s8']);
      assert.deepEqual(orderIds(await S(`${RANGE}&excludeDraft=true&industry=none`)), ['T-s5', 'T-s9']);
      // s1 was created at 23:30Z on 31 Oct = 1 Nov in Lagos: not in October, in November
      assert.deepEqual(orderIds(await S('createdFrom=2026-10-31&createdTo=2026-10-31')), ['T-s2']);
      assert.deepEqual(orderIds(await S('createdFrom=2026-11-01&createdTo=2026-11-01')), ['T-s1']);
      // drafts appear unless excluded
      assert.ok(orderIds(await S(`${RANGE}`)).includes('T-s6'));
    });

    test('invalid drill-down filters return 400; existing parameters are unchanged', async () => {
      for (const qs of ['createdFrom=2026-10-31&createdTo=2026-10-01', 'createdFrom=2026-02-30', 'dateField=updated', 'statusGroup=draft', 'excludeDraft=maybe', 'industry=bakery']) {
        const res = await request(app, 'GET', `/api/admin/shipments?${qs}`, { token: finance });
        assert.equal(res.status, 400, qs);
        assert.ok(Array.isArray(res.body.errors));
      }
      assert.equal((await list('/api/admin/shipments?status=pending&pageSize=100')).pagination.total, 4); // s1, s9, s10, s11
    });
  });

  describe('invoices', () => {
    const I = (qs: string) => list(`/api/admin/invoices?pageSize=100&${qs}`);

    test('Invoiced opens the invoices issued in range, drafts excluded, currency normalised', async () => {
      const summary = (await list(`/api/admin/reports/summary?${OCT}`)).data.revenue.byCurrency;
      const ngn = await I(`${ISSUED}&excludeDraft=true&currency=NGN`);
      assert.deepEqual(numbers(ngn), ['INV-i2', 'INV-i6', 'INV-i8']); // INV-i8 is stored as 'ngn '
      assert.equal(ngn.pagination.total, summary.NGN.invoiceCount);
      assert.equal(ngn.data.reduce((t: number, r: any) => t + r.amount, 0), Number(summary.NGN.invoiced));
      assert.deepEqual(numbers(await I(`${ISSUED}&excludeDraft=true&currency=usd`)), ['INV-i3', 'INV-i7']);
    });

    test('Collected opens the invoices that received a successful payment in range (paid_at, else created_at)', async () => {
      assert.deepEqual(numbers(await I(`${PAID}&currency=NGN`)), ['INV-i2', 'INV-i6']);
      assert.deepEqual(numbers(await I(`${PAID}&currency=USD`)), ['INV-i3']);
      assert.deepEqual(numbers(await I('paidFrom=2026-11-01&paidTo=2026-11-01')), ['INV-i1']); // the 23:30Z payment
    });

    test('Outstanding: the main card has no dates; the cohort adds the issue range', async () => {
      const summary = (await list(`/api/admin/reports/summary?${OCT}`)).data.revenue.byCurrency;
      const open = await I('excludeDraft=true&hasOutstanding=true&currency=NGN');
      assert.deepEqual(numbers(open), ['INV-i1', 'INV-i2', 'INV-i8', 'INV-i9']);
      assert.equal(open.pagination.total, summary.NGN.outstandingOpenCount);
      const cohort = await I(`${ISSUED}&excludeDraft=true&hasOutstanding=true&currency=NGN`);
      assert.deepEqual(numbers(cohort), ['INV-i2', 'INV-i8']);
      assert.equal(cohort.pagination.total, summary.NGN.outstandingIssuedInRangeCount);
      assert.deepEqual(numbers(await I('excludeDraft=true&hasOutstanding=true&currency=USD')), ['INV-i7']);
    });

    test('customer, industry and mode filters carry over', async () => {
      assert.deepEqual(numbers(await I(`${ISSUED}&excludeDraft=true&currency=NGN&customerId=${ids.B}`)), ['INV-i6', 'INV-i8']);
      assert.deepEqual(numbers(await I(`${ISSUED}&excludeDraft=true&industry=oil_gas`)), ['INV-i2', 'INV-i3']);
      assert.deepEqual(numbers(await I(`${ISSUED}&excludeDraft=true&mode=sea_freight`)), ['INV-i6']);
      assert.deepEqual(numbers(await I(`${ISSUED}&excludeDraft=true&industry=none`)), []);
      assert.ok(numbers(await I('')).includes('INV-i4'), 'drafts appear unless excluded');
      // the new field is additive
      assert.ok((await I(`${ISSUED}&excludeDraft=true`)).data[0].issuedAt);
    });

    test('invalid drill-down filters return 400', async () => {
      for (const qs of ['paidFrom=2026-10-31&paidTo=2026-10-01', 'issuedFrom=yesterday', 'hasOutstanding=1', 'mode=teleport', 'industry=bakery']) {
        assert.equal((await request(app, 'GET', `/api/admin/invoices?${qs}`, { token: finance })).status, 400, qs);
      }
    });
  });

  describe('customer detail money totals follow the invoices module', () => {
    test('present for finance_officer, omitted for support_staff', async () => {
      const withMoney = (await list(`/api/admin/customers/${ids.A}`)).data;
      assert.ok('totalInvoiced' in withMoney && 'totalPaid' in withMoney && 'outstandingBalance' in withMoney);
      const without = (await list(`/api/admin/customers/${ids.A}`, support)).data;
      assert.equal('totalInvoiced' in without || 'totalPaid' in without || 'outstandingBalance' in without, false);
      assert.equal(typeof without.shipmentCount, 'number');
    });
  });
});
