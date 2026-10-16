import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, customerToken, insertAdmin, insertCustomer, insertInvoice, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import reportsRoutes, { reportCapabilities } from '../src/modules/reports/reports.routes';
import invoicesRoutes from '../src/modules/invoices/invoices.routes';
import searchRoutes from '../src/modules/search/search.routes';

const ROLES = ['super_admin', 'manager', 'logistics_officer', 'finance_officer', 'crm_officer', 'support_staff'] as const;
// Written out here, independent of the server's role map: who may open reports, and who may see revenue.
const REPORTS = new Set(['super_admin', 'manager', 'finance_officer', 'support_staff']);
const REVENUE = new Set(['super_admin', 'manager', 'finance_officer']);
const Q = 'range=custom&from=2026-10-01&to=2026-10-31';

describe('report permissions', dbTest, () => {
  let app: TestApp;
  const tokens: Record<string, string> = {};
  let customerId: string;

  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/admin/reports', reportsRoutes], ['/api/admin/invoices', invoicesRoutes], ['/api/admin/search', searchRoutes]]);
    await truncateAll();
    clearAdminAccountCache();
    for (const role of ROLES) {
      const admin = await insertAdmin({ assignedRoles: [role] });
      tokens[role] = adminToken({ id: admin.id, email: admin.email, activeRole: role });
    }
    const c = await insertCustomer();
    customerId = c.id;
    const s = await insertShipment(c.id);
    await insertInvoice(c.id, { shipmentId: s.id });
  });
  after(async () => {
    delete process.env.PERMISSION_ENFORCEMENT;
    await app?.close();
    await pool.end();
  });

  const get = (path: string, role: string) => request(app, 'GET', `/api/admin/reports${path}`, { token: tokens[role] });

  const reportEndpoints = ['/meta', '/options/customers', `/summary?${Q}`, `/shipments/series?${Q}`, `/shipments/by-customer?${Q}`, `/customers?${Q}`];
  const revenueEndpoints = [`/revenue/series?${Q}`, `/revenue/by-customer?${Q}`];

  for (const mode of ['enforce', 'log'] as const) {
    describe(`PERMISSION_ENFORCEMENT=${mode}`, () => {
      before(() => { process.env.PERMISSION_ENFORCEMENT = mode; });
      for (const role of ROLES) {
        test(role, async () => {
          for (const path of reportEndpoints) {
            const res = await get(path, role);
            // Revenue is enforced always. The reports module guard honours the rollout flag like every other router.
            if (REPORTS.has(role) || mode === 'log') assert.equal(res.status, 200, `${role} ${path} ${JSON.stringify(res.body)}`);
            else assert.equal(res.status, 403, `${role} ${path}`);
          }
          for (const path of revenueEndpoints) {
            const res = await get(path, role);
            assert.equal(res.status, REVENUE.has(role) ? 200 : 403, `${role} ${path} ${JSON.stringify(res.body)}`);
          }
        });
      }
    });
  }

  describe('what each role is shown', () => {
    before(() => { delete process.env.PERMISSION_ENFORCEMENT; });

    for (const role of ROLES.filter((r) => REPORTS.has(r))) {
      test(`${role}: revenue ${REVENUE.has(role) ? 'present' : 'absent'} in summary, customers report and meta`, async () => {
        const summary = (await get(`/summary?${Q}`, role)).body.data;
        assert.equal('revenue' in summary, REVENUE.has(role));
        assert.equal(summary.capabilities.revenue, REVENUE.has(role));

        const customers = await get(`/customers?${Q}`, role);
        assert.equal(customers.status, 200);
        const row = customers.body.data[0];
        assert.equal('money' in row, REVENUE.has(role), 'money columns follow the invoices module');
        assert.equal('email' in row && 'phone' in row, true, 'contact columns follow the customers module (all report roles have it)');
        assert.ok(row.shipments);

        const meta = (await get('/meta', role)).body.data;
        assert.equal(meta.currencies.length > 0 || !REVENUE.has(role), true);
        if (!REVENUE.has(role)) assert.deepEqual(meta.currencies, []);
      });
    }

    test('support_staff cannot sort or request money columns', async () => {
      for (const sort of ['invoiced', 'collected', 'outstanding', 'invoiceCount']) {
        assert.equal((await get(`/customers?${Q}&sort=${sort}`, 'support_staff')).status, 400, sort);
        assert.equal((await get(`/customers?${Q}&sort=${sort}`, 'finance_officer')).status, 200, sort);
      }
    });

    test('support_staff gets 403 on revenue even with PERMISSION_ENFORCEMENT=log', async () => {
      process.env.PERMISSION_ENFORCEMENT = 'log';
      try {
        for (const path of revenueEndpoints) assert.equal((await get(path, 'support_staff')).status, 403, path);
      } finally {
        delete process.env.PERMISSION_ENFORCEMENT;
      }
    });

    test('capabilities come from the ACTIVE role', () => {
      assert.deepEqual(reportCapabilities('support_staff'), { revenue: false, contacts: true });
      assert.deepEqual(reportCapabilities('finance_officer'), { revenue: true, contacts: true });
      assert.deepEqual(reportCapabilities('crm_officer'), { revenue: false, contacts: true });
      assert.deepEqual(reportCapabilities('logistics_officer'), { revenue: false, contacts: false });
      assert.deepEqual(reportCapabilities(undefined), { revenue: false, contacts: false });
    });

    test('the customer picker returns names only', async () => {
      const res = await get('/options/customers?q=Test', 'support_staff');
      assert.deepEqual(Object.keys(res.body.data[0]).sort(), ['id', 'name']);
      assert.equal((await get('/options/customers?limit=21', 'support_staff')).status, 400);
    });
  });

  describe('authentication', () => {
    test('no token, a customer token and a deactivated admin are rejected', async () => {
      assert.equal((await request(app, 'GET', `/api/admin/reports/summary?${Q}`)).status, 401);
      const customer = await insertCustomer();
      const ct = customerToken({ id: customer.id, email: customer.email, user_id: customer.user_id });
      assert.equal((await request(app, 'GET', `/api/admin/reports/summary?${Q}`, { token: ct })).status, 401);

      const gone = await insertAdmin({ assignedRoles: ['manager'], isActive: false });
      const gt = adminToken({ id: gone.id, email: gone.email, activeRole: 'manager' });
      for (const path of ['/summary', '/revenue/series', '/customers']) {
        assert.equal((await request(app, 'GET', `/api/admin/reports${path}?${Q}`, { token: gt })).status, 401, path);
      }
    });
  });

  describe('the invoices list is no longer a Reports cross-read (support_staff)', () => {
    test('support_staff gets 403 on the invoices list and no invoice results in search', async () => {
      const res = await request(app, 'GET', '/api/admin/invoices', { token: tokens.support_staff });
      assert.equal(res.status, 403);
      const search = await request(app, 'GET', '/api/admin/search?q=Test', { token: tokens.support_staff });
      assert.equal(search.status, 200);
      assert.equal('invoices' in search.body.data, false);
      assert.equal((await request(app, 'GET', '/api/admin/invoices', { token: tokens.finance_officer })).status, 200);
    });
  });
});
