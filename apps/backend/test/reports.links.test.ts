import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin } from './helpers/fixtures';
import { OCT, seedReportData } from './helpers/reportsSeed';
import pool from '../src/config/db';
import reportsRoutes from '../src/modules/reports/reports.routes';
import shipmentsRoutes from '../src/modules/shipments/shipments.routes';
import invoicesRoutes from '../src/modules/invoices/invoices.routes';

// The REAL link builders the Reports page uses (admin/app/src/pages/admin/Reports/drilldown.ts, dependency-free on purpose),
// loaded the same way permissions.routes.test.ts loads the UI's role map. Each link is followed into the real list endpoint and
// its total must equal the figure the link was built from: the link carries the filters, and the filters mean the same thing.
// eslint-disable-next-line @typescript-eslint/no-require-imports
interface Links {
  shipmentsLink(metric: string, f: any, window?: { from: string; to: string }, customerId?: string | null): string;
  invoicesLink(metric: string, f: any, currency: string | null | undefined, window?: { from: string; to: string }, customerId?: string | null): string;
  customerLink(id: string): string;
}
const links = require(path.join(__dirname, '../../../app/src/pages/admin/Reports/drilldown.ts')) as Links;

describe('report drill-down links', dbTest, () => {
  let app: TestApp;
  let token: string;
  let ids: Record<string, string>;

  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/admin/reports', reportsRoutes], ['/api/admin/shipments', shipmentsRoutes], ['/api/admin/invoices', invoicesRoutes]]);
    await truncateAll();
    ids = await seedReportData();
    const a = await insertAdmin({ assignedRoles: ['finance_officer'] });
    token = adminToken({ id: a.id, email: a.email, activeRole: 'finance_officer' });
  });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const body = async (url: string) => {
    const res = await request(app, 'GET', url, { token });
    assert.equal(res.status, 200, `${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  /** '/admin/shipments?x=1' -> the API path the page would call. */
  const follow = (link: string) => body(link.replace('/admin/', '/api/admin/') + '&pageSize=100');

  const filtersOf = async (extra = '') => {
    const f = (await body(`/api/admin/reports/summary?${OCT}${extra}`)).data;
    return f as { filters: any; shipments: Record<string, number>; revenue: { byCurrency: Record<string, any> } };
  };

  test('shipment cards: every link lists exactly the shipments the card counted', async () => {
    const s = await filtersOf();
    const f = s.filters;
    for (const metric of ['created', 'pending', 'inProgress', 'completed', 'cancelled'] as const) {
      const list = await follow(links.shipmentsLink(metric, f));
      assert.equal(list.pagination.total, s.shipments[metric], metric);
    }
  });

  test('shipment links keep the active filters (customer, industry, mode) and narrow to a clicked period', async () => {
    for (const extra of [`&customerId=${ids.A}`, '&industry=mining', '&mode=groupage', `&customerId=${ids.A}&mode=air_freight`]) {
      const s = await filtersOf(extra);
      for (const metric of ['created', 'pending', 'inProgress', 'completed', 'cancelled'] as const) {
        const list = await follow(links.shipmentsLink(metric, s.filters));
        assert.equal(list.pagination.total, s.shipments[metric], `${metric} ${extra}`);
      }
    }
    // a clicked bar: one week of the weekly series, link carries that bucket's clipped dates
    const series = (await body('/api/admin/reports/shipments/series?range=custom&from=2026-10-05&to=2026-10-25&granularity=week')).data;
    for (const p of series.points) {
      const created = await follow(links.shipmentsLink('created', series.filters, p));
      const completed = await follow(links.shipmentsLink('completed', series.filters, p));
      assert.equal(created.pagination.total, p.created, `${p.label} created`);
      assert.equal(completed.pagination.total, p.completed, `${p.label} completed`);
    }
    // a customer row
    const byCustomer = (await body(`/api/admin/reports/shipments/by-customer?${OCT}`)).data;
    const ada = byCustomer.find((r: any) => r.name === 'Ada Obi');
    const s = await filtersOf();
    assert.equal((await follow(links.shipmentsLink('pending', s.filters, undefined, ada.customerId))).pagination.total, ada.pending);
  });

  test('revenue cards: every link lists exactly the invoices behind the figure', async () => {
    const s = await filtersOf();
    for (const currency of Object.keys(s.revenue.byCurrency)) {
      const v = s.revenue.byCurrency[currency];
      const f = s.filters;
      assert.equal((await follow(links.invoicesLink('invoiced', f, currency))).pagination.total, v.invoiceCount, `${currency} invoiced`);
      assert.equal((await follow(links.invoicesLink('outstandingOpen', f, currency))).pagination.total, v.outstandingOpenCount, `${currency} outstanding (all open)`);
      assert.equal((await follow(links.invoicesLink('outstandingIssued', f, currency))).pagination.total, v.outstandingIssuedInRangeCount, `${currency} outstanding (cohort)`);
      // Collected counts payments; the list holds the invoices that received them (one invoice can have several payments).
      const collected = await follow(links.invoicesLink('collected', f, currency));
      assert.ok(collected.pagination.total >= (v.paymentCount > 0 ? 1 : 0) && collected.pagination.total <= v.paymentCount, `${currency} collected`);
    }
  });

  test('the main Outstanding link has no dates; the cohort link has the range', async () => {
    const s = await filtersOf();
    const open = links.invoicesLink('outstandingOpen', s.filters, 'NGN');
    assert.doesNotMatch(open, /issued|paid|createdFrom/);
    assert.match(open, /hasOutstanding=true/);
    assert.match(links.invoicesLink('outstandingIssued', s.filters, 'NGN'), /issuedFrom=2026-10-01&issuedTo=2026-10-31/);
  });

  test('invoice links keep the active filters and narrow to a clicked period or customer', async () => {
    for (const extra of [`&customerId=${ids.B}`, '&industry=oil_gas', '&mode=sea_freight']) {
      const s = await filtersOf(extra);
      for (const currency of Object.keys(s.revenue.byCurrency)) {
        const v = s.revenue.byCurrency[currency];
        assert.equal((await follow(links.invoicesLink('invoiced', s.filters, currency))).pagination.total, v.invoiceCount, `${currency} invoiced ${extra}`);
      }
    }
    const series = (await body('/api/admin/reports/revenue/series?range=custom&from=2026-09-01&to=2026-11-30&granularity=month')).data;
    for (const p of series.points) {
      const ngn = p.byCurrency.NGN;
      assert.equal((await follow(links.invoicesLink('invoiced', series.filters, 'NGN', p))).pagination.total, ngn?.invoiceCount ?? 0, `${p.label} invoiced`);
    }
    const rows = (await body(`/api/admin/reports/revenue/by-customer?${OCT}&currency=NGN`)).data;
    const bayo = rows.find((r: any) => r.name === 'Bayo Ade');
    const s = await filtersOf();
    assert.equal((await follow(links.invoicesLink('invoiced', s.filters, 'NGN', undefined, bayo.customerId))).pagination.total, bayo.invoiceCount);
    assert.equal(links.customerLink(bayo.customerId), `/admin/customers/${bayo.customerId}`);
  });
});
