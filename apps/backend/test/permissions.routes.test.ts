import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin, insertCustomer, insertInvoice, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import authRoutes from '../src/modules/auth/auth.routes';
import customersRoutes from '../src/modules/customers/customers.routes';
import shipmentsRoutes from '../src/modules/shipments/shipments.routes';
import { adminTrackingRoutes } from '../src/modules/tracking/tracking.routes';
import invoicesRoutes from '../src/modules/invoices/invoices.routes';
import paymentsRoutes from '../src/modules/payments/payments.routes';
import communicationsRoutes from '../src/modules/communications/communications.routes';
import newsletterRoutes from '../src/modules/newsletter/newsletter.routes';
import reportsRoutes from '../src/modules/reports/reports.routes';
import feedbackRoutes from '../src/modules/feedback/feedback.routes';
import searchRoutes from '../src/modules/search/search.routes';

// Expected access comes from the admin UI's own role map plus this independent copy of the approved
// cross-reads (Phase 0 Item 6 audit), not from the server module under test.
const ROLES = ['super_admin', 'manager', 'logistics_officer', 'finance_officer', 'crm_officer', 'support_staff'];
// Loaded synchronously: test names and expectations are computed while the suite is being defined.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const UI: Record<string, string[]> = require(path.join(__dirname, '../../../app/src/utils/rolePermissions.ts')).rolePermissions;
const uiHas = (role: string, modules: string[]) => UI[role].includes('*') || modules.some((m) => UI[role].includes(m));

interface RouteCase {
  name: string;
  method: string;
  path: () => string;
  body?: object;
  modules: string[];
  write: boolean;
  supportMayWrite?: boolean;
}

describe('server-side role permissions', dbTest, () => {
  let app: TestApp;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  before(async () => {
    await resetDatabase();
    await truncateAll();
    const mounts: Array<[string, Router]> = [
      ['/api/auth', authRoutes],
      ['/api/admin/search', searchRoutes],
      ['/api/admin/customers', customersRoutes],
      ['/api/admin/shipments', shipmentsRoutes],
      ['/api/admin/tracking', adminTrackingRoutes],
      ['/api/admin/invoices', invoicesRoutes],
      ['/api/admin/payments', paymentsRoutes],
      ['/api/admin/communications', communicationsRoutes],
      ['/api/admin/newsletter', newsletterRoutes],
      ['/api/admin/reports', reportsRoutes],
      ['/api/admin/feedback', feedbackRoutes],
    ];
    app = await startApp(mounts);

    for (const role of ROLES) {
      const a = await insertAdmin({ assignedRoles: [role] });
      tokens[role] = adminToken({ id: a.id, email: a.email, activeRole: role });
    }
    const c = await insertCustomer();
    ids.customer = c.id;
    ids.shipment = (await insertShipment(c.id, { status: 'in_transit' })).id;
    ids.invoice = (await insertInvoice(c.id, { amount: '100.00' })).id;
  });

  after(async () => {
    delete process.env.PERMISSION_ENFORCEMENT;
    await app?.close();
    await pool.end();
  });

  const ROUTES: RouteCase[] = [
    { name: 'customers detail', method: 'GET', path: () => `/api/admin/customers/${ids.customer}`, modules: ['customers'], write: false },
    { name: 'customers list (cross-read: shipments)', method: 'GET', path: () => '/api/admin/customers', modules: ['customers', 'shipments'], write: false },
    { name: 'customers profile edit', method: 'PUT', path: () => `/api/admin/customers/${ids.customer}`, body: { firstname: 'Test', lastname: 'Customer', email: `c-${crypto.randomUUID()}@test.local` }, modules: ['customers'], write: true, supportMayWrite: true },
    { name: 'customers star', method: 'PUT', path: () => `/api/admin/customers/${ids.customer}/star`, body: { starRating: 3 }, modules: ['customers'], write: true },
    { name: 'shipments list', method: 'GET', path: () => '/api/admin/shipments', modules: ['shipments'], write: false },
    { name: 'shipments tracking fields', method: 'PUT', path: () => `/api/admin/shipments/${ids.shipment}/tracking`, body: { awbNumber: 'AWB-1' }, modules: ['shipments'], write: true },
    { name: 'tracking list', method: 'GET', path: () => '/api/admin/tracking', modules: ['tracking'], write: false },
    { name: 'tracking note (cross: shipments)', method: 'POST', path: () => `/api/admin/tracking/${ids.shipment}/update`, body: { message: 'note' }, modules: ['tracking', 'shipments'], write: true },
    { name: 'invoices detail', method: 'GET', path: () => `/api/admin/invoices/${ids.invoice}`, modules: ['invoices'], write: false },
    { name: 'invoices list (cross-read: reports)', method: 'GET', path: () => '/api/admin/invoices', modules: ['invoices', 'reports'], write: false },
    { name: 'invoices reminder', method: 'PUT', path: () => `/api/admin/invoices/${ids.invoice}/reminder`, body: { followUpDate: null }, modules: ['invoices'], write: true },
    { name: 'payments list', method: 'GET', path: () => '/api/admin/payments', modules: ['payments'], write: false },
    { name: 'communications list', method: 'GET', path: () => '/api/admin/communications', modules: ['communications'], write: false },
    { name: 'communications thread (cross-read: customers)', method: 'GET', path: () => `/api/admin/communications/${ids.customer}`, modules: ['communications', 'customers'], write: false },
    { name: 'communications delete', method: 'DELETE', path: () => `/api/admin/communications/${crypto.randomUUID()}`, modules: ['communications'], write: true },
    { name: 'newsletter segments', method: 'GET', path: () => '/api/admin/newsletter/segments', modules: ['newsletter'], write: false },
    { name: 'newsletter preview count', method: 'POST', path: () => '/api/admin/newsletter/preview-count', body: { segments: ['all'], status: 'all' }, modules: ['newsletter'], write: true },
    { name: 'reports', method: 'GET', path: () => '/api/admin/reports/monthly', modules: ['reports'], write: false },
    { name: 'feedback (gated by reports)', method: 'GET', path: () => '/api/admin/feedback', modules: ['reports'], write: false },
    { name: 'own profile (any role)', method: 'GET', path: () => '/api/auth/admin/me', modules: ['*'], write: false },
    { name: 'own profile edit (support self-service)', method: 'PUT', path: () => '/api/auth/admin/profile', body: { name: 'Renamed' }, modules: ['*'], write: true, supportMayWrite: true },
    { name: 'own notification prefs (support self-service)', method: 'PUT', path: () => '/api/auth/admin/notification-preferences', body: { notificationPrefs: { registration: true } }, modules: ['*'], write: true, supportMayWrite: true },
  ];

  const moduleAllowed = (role: string, r: RouteCase) => r.modules.includes('*') || uiHas(role, r.modules);
  const supportBlocked = (role: string, r: RouteCase) => role === 'support_staff' && r.write && !r.supportMayWrite;

  for (const mode of ['enforce', 'log'] as const) {
    describe(`PERMISSION_ENFORCEMENT=${mode}`, () => {
      before(() => { process.env.PERMISSION_ENFORCEMENT = mode; });
      for (const r of ROUTES) {
        for (const role of ROLES) {
          const blockedByModule = !moduleAllowed(role, r);
          const expectDeny = supportBlocked(role, r) || (mode === 'enforce' && blockedByModule);
          test(`${role} · ${r.method} ${r.name} → ${expectDeny ? '403' : 'allowed'}${mode === 'log' && blockedByModule ? ' (logged)' : ''}`, async () => {
            const warn = mock.method(console, 'warn', () => {});
            try {
              const res = await request(app, r.method, r.path(), { token: tokens[role], body: r.body });
              if (expectDeny) {
                assert.equal(res.status, 403, JSON.stringify(res.body));
              } else {
                assert.ok(![401, 403].includes(res.status), `got ${res.status}: ${JSON.stringify(res.body)}`);
                assert.ok(res.status < 500, `server error ${res.status}: ${JSON.stringify(res.body)}`);
              }
              const denials = warn.mock.calls
                .map((c) => { try { return JSON.parse(String(c.arguments[0])); } catch { return null; } })
                .filter((x) => x?.event === 'permission_denied');
              if (mode === 'log' && blockedByModule && !supportBlocked(role, r)) {
                assert.equal(denials.length, 1, 'one structured denial line');
                const line = denials[0];
                assert.equal(line.activeRole, role);
                assert.equal(line.method, r.method);
                assert.equal(line.mode, 'log');
                assert.ok(line.adminId);
                assert.ok(String(line.route).startsWith('/api/'));
                assert.ok(line.module);
              } else {
                assert.equal(denials.length, 0, 'no denial logged');
              }
            } finally {
              warn.mock.restore();
            }
          });
        }
      }
    });
  }

  describe('search result groups are filtered by role (ROLE_MODULES + approved cross-reads)', () => {
    before(() => { delete process.env.PERMISSION_ENFORCEMENT; });
    for (const role of ROLES) {
      test(role, async () => {
        const expected = [
          uiHas(role, ['customers', 'shipments']) ? 'customers' : null,
          uiHas(role, ['shipments']) ? 'shipments' : null,
          uiHas(role, ['invoices', 'reports']) ? 'invoices' : null,
        ].filter(Boolean);
        for (const q of ['Test', '']) {
          const res = await request(app, 'GET', `/api/admin/search?q=${q}`, { token: tokens[role] });
          assert.equal(res.status, 200);
          assert.deepEqual(Object.keys(res.body.data).sort(), [...expected].sort(), `q=${q}`);
        }
      });
    }
  });

  describe('account state is always enforced (both modes)', () => {
    for (const mode of ['enforce', 'log'] as const) {
      test(`inactive, deleted, and role-no-longer-assigned admins get 401 (${mode})`, async () => {
        process.env.PERMISSION_ENFORCEMENT = mode;
        const inactive = await insertAdmin({ assignedRoles: ['manager'], isActive: false });
        const deleted = await insertAdmin({ assignedRoles: ['manager'], deleted: true });
        const demoted = await insertAdmin({ assignedRoles: ['logistics_officer'] });
        const cases = [
          adminToken({ id: inactive.id, email: inactive.email, activeRole: 'manager' }),
          adminToken({ id: deleted.id, email: deleted.email, activeRole: 'manager' }),
          adminToken({ id: demoted.id, email: demoted.email, activeRole: 'manager', assignedRoles: ['manager'] }),
          adminToken({ id: crypto.randomUUID(), email: 'ghost@test.local', activeRole: 'manager' }),
        ];
        for (const token of cases) {
          for (const p of ['/api/admin/shipments', '/api/auth/admin/me', '/api/admin/search?q=x']) {
            assert.equal((await request(app, 'GET', p, { token })).status, 401, p);
          }
        }
      });
    }

    test('account lookups are cached for up to 30s; clearing the cache applies a deactivation immediately', async () => {
      delete process.env.PERMISSION_ENFORCEMENT;
      const a = await insertAdmin({ assignedRoles: ['manager'] });
      const token = adminToken({ id: a.id, email: a.email, activeRole: 'manager' });
      assert.equal((await request(app, 'GET', '/api/admin/shipments', { token })).status, 200);
      await pool.query('UPDATE admins SET is_active = false WHERE id = $1', [a.id]);
      assert.equal((await request(app, 'GET', '/api/admin/shipments', { token })).status, 200, 'still cached');
      clearAdminAccountCache(a.id);
      assert.equal((await request(app, 'GET', '/api/admin/shipments', { token })).status, 401);
    });
  });

  describe('login rejects inactive and deleted admins with the same generic error (R-09)', () => {
    test('active ok; inactive/deleted/wrong password are indistinguishable', async () => {
      const hash = await bcrypt.hash('Correct-Horse-1', 4);
      const mk = async (active: boolean, deleted: boolean) => {
        const email = `login-${crypto.randomUUID()}@test.local`;
        await pool.query(
          `INSERT INTO admins (name, email, password_hash, assigned_roles, is_active, deleted_at) VALUES ('L', $1, $2, ARRAY['manager'], $3, $4)`,
          [email, hash, active, deleted ? new Date() : null]
        );
        return email;
      };
      const ok = await request(app, 'POST', '/api/auth/admin/login', { body: { email: await mk(true, false), password: 'Correct-Horse-1' } });
      assert.equal(ok.status, 200);

      const wrong = await request(app, 'POST', '/api/auth/admin/login', { body: { email: await mk(true, false), password: 'nope' } });
      const inactive = await request(app, 'POST', '/api/auth/admin/login', { body: { email: await mk(false, false), password: 'Correct-Horse-1' } });
      const deleted = await request(app, 'POST', '/api/auth/admin/login', { body: { email: await mk(false, true), password: 'Correct-Horse-1' } });
      for (const r of [inactive, deleted]) {
        assert.equal(r.status, wrong.status);
        assert.deepEqual(r.body, wrong.body);
      }
      assert.equal(wrong.status, 401);
    });
  });

  describe('communications thread marks messages read only for roles with the communications module (R-47)', () => {
    test('finance (cross-module reader) leaves them unread; crm marks them read', async () => {
      delete process.env.PERMISSION_ENFORCEMENT;
      const c = await insertCustomer();
      await pool.query(
        `INSERT INTO communications (customer_id, sent_by_customer, sender_type, subject, body, read_by_admin, read_by_customer)
         VALUES ($1, $1, 'customer', 'Hi', 'Question', false, true)`,
        [c.id]
      );
      const unread = async () => (await pool.query(`SELECT COUNT(*)::int AS n FROM communications WHERE customer_id = $1 AND read_by_admin = false`, [c.id])).rows[0].n;

      const fin = await request(app, 'GET', `/api/admin/communications/${c.id}`, { token: tokens.finance_officer });
      assert.equal(fin.status, 200);
      assert.equal(fin.body.data.length, 1);
      assert.equal(await unread(), 1, 'finance read-only');

      assert.equal((await request(app, 'GET', `/api/admin/communications/${c.id}`, { token: tokens.crm_officer })).status, 200);
      assert.equal(await unread(), 0, 'crm marks read');
    });
  });

  describe('support_staff customer scope (R-20, approved: create + profile edit only)', () => {
    test('create and profile edit allowed; star/status/segment/delete blocked', async () => {
      delete process.env.PERMISSION_ENFORCEMENT;
      const t = tokens.support_staff;
      const created = await request(app, 'POST', '/api/admin/customers', {
        token: t,
        body: { firstname: 'Sam', lastname: 'Support', email: `s-${crypto.randomUUID()}@test.local`, phone: '1', industry: 'others' },
      });
      assert.ok(![401, 403].includes(created.status), `create: ${created.status} ${JSON.stringify(created.body)}`);
      const id = ids.customer;
      assert.ok(![401, 403].includes((await request(app, 'PUT', `/api/admin/customers/${id}`, { token: t, body: { firstname: 'A', lastname: 'B', email: `e-${crypto.randomUUID()}@test.local` } })).status));
      for (const [method, p, body] of [
        ['PUT', `/api/admin/customers/${id}/star`, { starRating: 2 }],
        ['PUT', `/api/admin/customers/${id}/status`, { status: 'lead' }],
        ['PUT', `/api/admin/customers/${id}/segment`, { industry: 'others' }],
        ['DELETE', `/api/admin/customers/${id}`, undefined],
      ] as const) {
        assert.equal((await request(app, method, p, { token: t, body })).status, 403, `${method} ${p}`);
      }
    });
  });
});
