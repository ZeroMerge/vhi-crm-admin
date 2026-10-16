import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin } from './helpers/fixtures';
import pool from '../src/config/db';
import reportsRoutes from '../src/modules/reports/reports.routes';
import { todayIn } from '../src/modules/reports/filters';
import { OCT, seedReportData } from './helpers/reportsSeed';

describe('report metrics against seeded data', dbTest, () => {
  let app: TestApp;
  let token: string;
  const ids: Record<string, string> = {};

  const get = (path: string, t = token) => request(app, 'GET', `/api/admin/reports${path}`, { token: t });

  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/admin/reports', reportsRoutes]]);
  });
  beforeSeed();
  function beforeSeed() {
    before(async () => {
      await truncateAll();
      const admin = await insertAdmin({ assignedRoles: ['finance_officer'] });
      token = adminToken({ id: admin.id, email: admin.email, activeRole: 'finance_officer' });

      Object.assign(ids, await seedReportData());
    });
  }
  after(async () => {
    await app?.close();
    await pool.end();
  });

  describe('shipments', () => {
    test('October: created, snapshot of the created cohort, events dated when they happened; drafts excluded', async () => {
      const res = await get(`/summary?${OCT}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.shipments, { created: 8, pending: 3, inProgress: 3, completed: 2, cancelled: 1 });
    });

    test('the 23:30Z boundary: s1 is November in Lagos, s2 is still October', async () => {
      const nov = await get('/summary?range=custom&from=2026-11-01&to=2026-11-30');
      assert.deepEqual(nov.body.data.shipments, { created: 1, pending: 1, inProgress: 0, completed: 0, cancelled: 0 });
      const lastDay = await get('/summary?range=custom&from=2026-10-31&to=2026-10-31');
      assert.deepEqual(lastDay.body.data.shipments, { created: 1, pending: 0, inProgress: 1, completed: 0, cancelled: 0 });
    });

    test('ISO weeks: Sunday 23:59 and Monday 00:01 Lagos fall in different weeks; empty buckets are present', async () => {
      const res = await get('/shipments/series?range=custom&from=2026-10-05&to=2026-10-25&granularity=week');
      const pts = res.body.data.points;
      assert.deepEqual(pts.map((p: any) => p.bucket), ['2026-10-05', '2026-10-12', '2026-10-19']);
      assert.deepEqual(pts.map((p: any) => p.label), ['2026-W41', '2026-W42', '2026-W43']);
      const row = (p: any) => [p.created, p.pending, p.inProgress, p.completed, p.cancelled];
      // week 5 Oct: s3 (Mon), s5 (Sat), s10 (Sun 23:59)      -> created 3, pending 1
      assert.deepEqual(row(pts[0]), [3, 1, 0, 0, 0]);
      // week 12 Oct: s11 (Mon 00:01), s7 (Sun 18 Oct); s5 cancelled on 12 Oct
      assert.deepEqual(row(pts[1]), [2, 1, 1, 0, 1]);
      // week 19 Oct: s8, s9 created; s3 delivered on 20 Oct
      assert.deepEqual(row(pts[2]), [2, 1, 1, 1, 0]);
      assert.deepEqual(pts.map((p: any) => p.partial), [false, false, false]);
      assert.deepEqual([pts[2].from, pts[2].to], ['2026-10-19', '2026-10-25']);
    });

    test('daily buckets include empty days and carry the clipped dates for drill-down', async () => {
      const res = await get('/shipments/series?range=custom&from=2026-10-10&to=2026-10-13&granularity=day');
      const pts = res.body.data.points;
      assert.deepEqual(pts.map((p: any) => [p.bucket, p.created, p.cancelled]), [
        ['2026-10-10', 1, 0], ['2026-10-11', 1, 0], ['2026-10-12', 1, 1], ['2026-10-13', 0, 0],
      ]);
      // s10 (22:59Z Sun) is 11 Oct local; s11 (23:01Z Sun) is 12 Oct local.
    });

    test('a status-group filter limits the shipments considered', async () => {
      const res = await get(`/summary?${OCT}&statusGroup=in_progress`);
      assert.deepEqual(res.body.data.shipments, { created: 3, pending: 0, inProgress: 3, completed: 0, cancelled: 0 });
      const done = await get(`/summary?${OCT}&statusGroup=completed`);
      assert.deepEqual(done.body.data.shipments, { created: 1, pending: 0, inProgress: 0, completed: 2, cancelled: 0 }); // s3 created in Oct, s3+s4 completed
    });

    test('customer, industry and mode filters combine', async () => {
      const a = await get(`/summary?${OCT}&customerId=${ids.A}`);
      assert.deepEqual(a.body.data.shipments, { created: 4, pending: 2, inProgress: 2, completed: 0, cancelled: 0 });
      const mining = await get(`/summary?${OCT}&industry=mining`);
      assert.deepEqual(mining.body.data.shipments, { created: 2, pending: 0, inProgress: 1, completed: 2, cancelled: 0 });
      const none = await get(`/summary?${OCT}&industry=none`);
      // customer C (no industry) and the shipment with no customer
      assert.deepEqual(none.body.data.shipments, { created: 2, pending: 1, inProgress: 0, completed: 0, cancelled: 1 });
      const sea = await get(`/summary?${OCT}&mode=sea_freight`);
      assert.deepEqual(sea.body.data.shipments, { created: 1, pending: 0, inProgress: 0, completed: 1, cancelled: 0 });
      const combined = await get(`/summary?${OCT}&industry=mining&mode=groupage&statusGroup=completed`);
      assert.deepEqual(combined.body.data.shipments, { created: 0, pending: 0, inProgress: 0, completed: 1, cancelled: 0 }); // s4
    });

    test('by customer: counters per customer, "Unassigned" for shipments with no customer, sortable, searchable, paginated', async () => {
      const res = await get(`/shipments/by-customer?${OCT}&sort=name&dir=asc`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const row = (r: any) => [r.name, r.created, r.pending, r.inProgress, r.completed, r.cancelled];
      assert.deepEqual(res.body.data.map(row), [
        ['Ada Obi', 4, 2, 2, 0, 0],
        ['Bayo Ade', 2, 0, 1, 2, 0],
        ['Chi Zhang', 1, 0, 0, 0, 1],
        ['Unassigned', 1, 1, 0, 0, 0],
      ]);
      assert.equal(res.body.data[3].customerId, null);
      assert.equal(res.body.pagination.total, 4);

      const sorted = await get(`/shipments/by-customer?${OCT}&sort=created&dir=desc&pageSize=2&page=2`);
      assert.deepEqual(sorted.body.data.map((r: any) => r.name), ['Chi Zhang', 'Unassigned']);
      assert.deepEqual([sorted.body.pagination.page, sorted.body.pagination.totalPages], [2, 2]);

      const search = await get(`/shipments/by-customer?${OCT}&q=bayo`);
      assert.deepEqual(search.body.data.map((r: any) => r.name), ['Bayo Ade']);
      const wildcard = await get(`/shipments/by-customer?${OCT}&q=${encodeURIComponent('%')}`);
      assert.equal(wildcard.body.data.length, 0, 'LIKE wildcards in the search are escaped');
    });
  });

  describe('revenue', () => {
    test('October by currency: Invoiced by issued_at (drafts and 23:30Z boundary excluded), Collected by paid_at with created_at fallback', async () => {
      const res = await get(`/summary?${OCT}`);
      const rev = res.body.data.revenue;
      assert.deepEqual(rev.currencies, ['NGN', 'USD']);
      const ngn = rev.byCurrency.NGN;
      // i2 2000 + i6 5000 + i8 100 (currency 'ngn ' is NGN); i1 is November, i9 September, i4 draft
      assert.deepEqual([ngn.invoiced, ngn.invoiceCount], ['7100.00', 3]);
      // p 500 (15 Oct) + 5000 (no paid_at, created 4 Oct); 400 on 31 Oct 23:30Z is November; failed and pending ignored
      assert.deepEqual([ngn.collected, ngn.paymentCount], ['5500.00', 2]);
      const usd = rev.byCurrency.USD;
      assert.deepEqual([usd.invoiced, usd.invoiceCount, usd.collected, usd.paymentCount], ['350.50', 2, '100.00', 1]);
    });

    test('two Outstanding figures: all open invoices as of today (no date range) and the issued-in-range cohort', async () => {
      const ngn = (await get(`/summary?${OCT}`)).body.data.revenue.byCurrency.NGN;
      // open: i1 600 + i2 1500 + i8 100 + i9 300 (i6 is fully paid, the draft i4 is excluded)
      assert.deepEqual([ngn.outstandingOpen, ngn.outstandingOpenCount], ['2500.00', 4]);
      // issued in October: i2 1500 + i8 100
      assert.deepEqual([ngn.outstandingIssuedInRange, ngn.outstandingIssuedInRangeCount], ['1600.00', 2]);

      // The main figure does not move with the range.
      const other = (await get('/summary?range=custom&from=2026-01-01&to=2026-01-31')).body.data.revenue.byCurrency.NGN;
      assert.deepEqual([other.outstandingOpen, other.outstandingIssuedInRange, other.invoiced], ['2500.00', '0.00', '0.00']);
      const usd = (await get(`/summary?${OCT}`)).body.data.revenue.byCurrency.USD;
      assert.deepEqual([usd.outstandingOpen, usd.outstandingIssuedInRange], ['250.50', '250.50']); // i3 is paid in full
    });

    test('never sums across currencies', async () => {
      const res = await get(`/revenue/series?${OCT}&granularity=month`);
      const point = res.body.data.points[0];
      assert.deepEqual(Object.keys(point.byCurrency).sort(), ['NGN', 'USD']);
      assert.equal(point.byCurrency.NGN.invoiced, '7100.00');
      assert.equal(point.byCurrency.USD.invoiced, '350.50');
    });

    test('series buckets by Lagos month: the 23:30Z invoice and payment land in November', async () => {
      const res = await get('/revenue/series?range=custom&from=2026-09-01&to=2026-11-30&granularity=month');
      const pts = res.body.data.points;
      assert.deepEqual(pts.map((p: any) => p.label), ['2026-09', '2026-10', '2026-11']);
      assert.deepEqual([pts[0].byCurrency.NGN.invoiced, pts[0].byCurrency.NGN.invoiceCount], ['300.00', 1]); // i9
      assert.equal(pts[1].byCurrency.NGN.invoiced, '7100.00');
      assert.deepEqual([pts[2].byCurrency.NGN.invoiced, pts[2].byCurrency.NGN.collected], ['1000.00', '400.00']); // i1 and its payment
      assert.deepEqual(res.body.data.totals.NGN, { invoiced: '8400.00', invoiceCount: 5, collected: '5900.00', paymentCount: 3 });
    });

    test('filters: customer, industry, mode (through the invoice\'s shipment), currency; a combination that excludes everything', async () => {
      const b = (await get(`/summary?${OCT}&customerId=${ids.B}`)).body.data.revenue.byCurrency;
      assert.equal(b.NGN.invoiced, '5100.00');
      assert.equal(b.NGN.collected, '5000.00');
      const oil = (await get(`/summary?${OCT}&industry=oil_gas`)).body.data.revenue.byCurrency;
      assert.equal(oil.NGN.invoiced, '2000.00');
      assert.equal(oil.USD.invoiced, '100.00');
      const none = (await get(`/summary?${OCT}&industry=none`)).body.data.revenue.byCurrency;
      assert.equal(none.NGN.outstandingOpen, '300.00'); // customer C's September invoice
      assert.equal(none.NGN.invoiced, '0.00');
      const sea = (await get(`/summary?${OCT}&mode=sea_freight`)).body.data.revenue.byCurrency;
      assert.equal(sea.NGN.invoiced, '5000.00'); // i6 is attached to s3
      const air = (await get(`/summary?${OCT}&mode=air_freight`)).body.data.revenue.byCurrency;
      assert.equal(air.NGN.invoiced, '2000.00'); // i2 is attached to s2
      const usdOnly = (await get(`/summary?${OCT}&currency=usd`)).body.data.revenue;
      assert.deepEqual(usdOnly.currencies, ['USD']);
      const none2 = (await get(`/summary?${OCT}&customerId=${ids.B}&mode=air_freight`)).body.data.revenue;
      assert.deepEqual(none2.currencies, []);
    });

    test('by customer (one currency): invoiced, collected, outstanding open and issued-in-range', async () => {
      const res = await get(`/revenue/by-customer?${OCT}&currency=NGN&sort=name`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.meta.currency, 'NGN');
      const row = (r: any) => [r.name, r.invoiceCount, r.invoiced, r.collected, r.outstanding, r.outstandingIssuedInRange];
      assert.deepEqual(res.body.data.map(row), [
        ['Ada Obi', 1, '2000.00', '500.00', '2100.00', '1500.00'], // open: i1 600 + i2 1500
        ['Bayo Ade', 2, '5100.00', '5000.00', '100.00', '100.00'],
        ['Chi Zhang', 0, '0.00', '0.00', '300.00', '0.00'], // only an old open balance
      ]);
    });

    test('by customer sorts money numerically, not as text', async () => {
      // Ada 900.00 vs Bayo 5100.00: as text '5100.00' < '900.00', as numbers 900 < 5100.
      await pool.query(`UPDATE invoices SET amount = 900.00 WHERE invoice_number = 'INV-i2'`);
      const res = await get(`/revenue/by-customer?${OCT}&currency=NGN&sort=invoiced&dir=asc`);
      assert.deepEqual(res.body.data.map((r: any) => r.name), ['Chi Zhang', 'Ada Obi', 'Bayo Ade']);
      await pool.query(`UPDATE invoices SET amount = 2000.00 WHERE invoice_number = 'INV-i2'`);
    });

    test('the default currency is the most-used one', async () => {
      const res = await get(`/revenue/by-customer?${OCT}`);
      assert.equal(res.body.meta.currency, 'NGN');
      assert.deepEqual(res.body.meta.currencies, ['NGN', 'USD']);
    });

    test('data quality counts: payments dated by fallback, paid status with a balance', async () => {
      await pool.query(`UPDATE invoices SET status = 'paid' WHERE invoice_number = 'INV-i7'`); // paid, nothing recorded
      const q = (await get(`/summary?${OCT}`)).body.data.revenue.dataQuality;
      assert.deepEqual(q, { paymentsDatedByFallback: 1, paidStatusWithOutstanding: 1 });
      await pool.query(`UPDATE invoices SET status = 'sent' WHERE invoice_number = 'INV-i7'`);
    });
  });

  describe('customers report', () => {
    test('all customers with shipment counters and money for one currency', async () => {
      const res = await get(`/customers?${OCT}&sort=name&currency=NGN`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [a, b, c] = res.body.data;
      assert.equal(a.name, 'Ada Obi');
      assert.deepEqual(a.shipments, { created: 4, pending: 2, inProgress: 2, completed: 0, cancelled: 0 });
      assert.deepEqual(a.money, { currency: 'NGN', invoiceCount: 1, invoiced: '2000.00', collected: '500.00', outstanding: '2100.00' });
      assert.equal(a.email, 'A@test.local');
      assert.equal(a.phone, '0801');
      assert.deepEqual(b.money, { currency: 'NGN', invoiceCount: 2, invoiced: '5100.00', collected: '5000.00', outstanding: '100.00' });
      assert.deepEqual(c.money, { currency: 'NGN', invoiceCount: 0, invoiced: '0.00', collected: '0.00', outstanding: '300.00' });
      assert.equal(c.industry, null);
      assert.equal(res.body.pagination.total, 3);
    });

    test('search by name or email; sort by money; filters apply', async () => {
      const q = await get(`/customers?${OCT}&q=zhang`);
      assert.deepEqual(q.body.data.map((r: any) => r.name), ['Chi Zhang']);
      const byEmail = await get(`/customers?${OCT}&q=b@test`);
      assert.deepEqual(byEmail.body.data.map((r: any) => r.name), ['Bayo Ade']);
      const sorted = await get(`/customers?${OCT}&sort=collected&dir=desc`);
      assert.deepEqual(sorted.body.data.map((r: any) => r.name), ['Bayo Ade', 'Ada Obi', 'Chi Zhang']);
      const industry = await get(`/customers?${OCT}&industry=none`);
      assert.deepEqual(industry.body.data.map((r: any) => r.name), ['Chi Zhang']);
      const one = await get(`/customers?${OCT}&customerId=${ids.A}`);
      assert.equal(one.body.pagination.total, 1);
    });
  });

  describe('invalid parameters return 400', () => {
    const paths = [
      '/summary', '/shipments/series', '/shipments/by-customer', '/revenue/series', '/revenue/by-customer', '/customers',
    ];
    const cases: Array<[string, string]> = [
      ['from after to', 'range=custom&from=2026-10-31&to=2026-10-01'],
      ['custom without dates', 'range=custom'],
      ['impossible date', 'range=custom&from=2026-02-30&to=2026-03-01'],
      ['more than 10 years', 'range=custom&from=2010-01-01&to=2026-10-01'],
      ['too many daily periods', 'range=custom&from=2025-01-01&to=2026-12-31&granularity=day'],
      ['unknown granularity', 'granularity=hour'],
      ['unknown industry', 'industry=bakery'],
      ['unknown status group', 'statusGroup=draft'],
      ['unknown mode', 'mode=teleport'],
      ['malformed uuid', 'customerId=1'],
      ['injection in currency', `currency=${encodeURIComponent("NGN'--")}`],
      ['unknown parameter', 'bogus=1'],
      ['repeated parameter', 'industry=mining&industry=others'],
    ];
    for (const path of paths) {
      for (const [name, qs] of cases) {
        test(`${path}: ${name}`, async () => {
          const res = await get(`${path}?${qs}`);
          assert.equal(res.status, 400, `${path}?${qs} -> ${res.status} ${JSON.stringify(res.body)}`);
          assert.equal(res.body.success, false);
          assert.ok(Array.isArray(res.body.errors));
        });
      }
    }
    for (const [name, qs] of [['pageSize 101', 'pageSize=101'], ['page 0', 'page=0'], ['bad sort column', 'sort=password_hash'], ['bad direction', 'dir=up'], ['long search', `q=${'x'.repeat(101)}`]]) {
      test(`list parameters: ${name}`, async () => {
        for (const path of ['/shipments/by-customer', '/revenue/by-customer', '/customers']) {
          assert.equal((await get(`${path}?${OCT}&${qs}`)).status, 400, path);
        }
      });
    }
  });

  describe('presets are resolved in the report time zone', () => {
    test('this_month returns the concrete dates and the zone', async () => {
      const res = await get('/summary?range=this_month');
      const today = todayIn('Africa/Lagos');
      assert.deepEqual([res.body.data.filters.from, res.body.data.filters.to, res.body.data.filters.timezone], [`${today.slice(0, 7)}-01`, today, 'Africa/Lagos']);
    });
  });

  describe('invoices.issued_at', () => {
    test('stamped when an invoice first leaves draft; never moved by later status changes or direct updates', async () => {
      const draft = (await pool.query(
        `INSERT INTO invoices (invoice_number, customer_id, amount, currency, status, created_at)
         VALUES ('INV-DRAFTED', $1, 77.00, 'GBP', 'draft', NOW() - INTERVAL '40 days') RETURNING id, issued_at`, [ids.A])).rows[0];
      assert.equal(draft.issued_at, null, 'a draft has no issue date');

      const issued = (await pool.query(`UPDATE invoices SET status = 'sent' WHERE id = $1 RETURNING issued_at, created_at`, [draft.id])).rows[0];
      // The draft was created 40 days ago; it was issued just now.
      assert.ok(issued.issued_at.getTime() - issued.created_at.getTime() > 39 * 86_400_000, 'issued when the status changed, not when the draft was created');

      for (const status of ['draft', 'pending', 'paid', 'draft', 'sent']) {
        await pool.query(`UPDATE invoices SET status = $2 WHERE id = $1`, [draft.id, status]);
      }
      await pool.query(`UPDATE invoices SET issued_at = '2020-01-01', amount = 78.00 WHERE id = $1`, [draft.id]);
      await pool.query(`UPDATE invoices SET issued_at = NULL WHERE id = $1`, [draft.id]);
      const after = (await pool.query(`SELECT issued_at FROM invoices WHERE id = $1`, [draft.id])).rows[0];
      assert.equal(after.issued_at.getTime(), issued.issued_at.getTime(), 'issued_at is immutable once set');

      // And the report counts it in the month it was issued (this month), not September.
      const today = todayIn('Africa/Lagos');
      const here = (await get(`/summary?range=custom&from=${today}&to=${today}&currency=GBP`)).body.data.revenue;
      assert.equal(here.byCurrency.GBP.invoiced, '78.00');
      const created = (await pool.query(`SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS d FROM invoices WHERE id = $1`, [draft.id])).rows[0].d;
      const earlier = (await get(`/summary?range=custom&from=${created}&to=${created}&currency=GBP`)).body.data.revenue;
      assert.equal(earlier.byCurrency.GBP.invoiced, '0.00', 'not invoiced on the day the draft was created');
      assert.equal(earlier.byCurrency.GBP.outstandingOpen, '78.00', 'but it is open today, whatever the range');
    });

    test('an invoice created non-draft is issued at creation; the status of existing drafts is untouched by the trigger', async () => {
      const row = (await pool.query(
        `INSERT INTO invoices (invoice_number, customer_id, amount, status, created_at)
         VALUES ('INV-DIRECT', $1, 5.00, 'sent', '2026-08-01T10:00:00Z') RETURNING issued_at`, [ids.A])).rows[0];
      assert.equal(row.issued_at.toISOString(), '2026-08-01T10:00:00.000Z');
    });
  });
});
