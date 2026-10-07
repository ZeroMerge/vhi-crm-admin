import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, customerToken, insertAdmin, insertCustomer, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import { emit } from '../src/modules/notifications/notification.service';
import type { NotificationEvent } from '../src/modules/notifications/events';
import { initEmail } from '../src/modules/email';
import { EmailWorker } from '../src/modules/email/worker';
import type { EmailProvider, OutgoingEmail } from '../src/modules/email/provider';
import { createUnsubscribeToken } from '../src/modules/email/unsubscribeToken';
import emailRoutes from '../src/modules/email/email.routes';
import clientPreferencesRoutes from '../src/modules/client/client.preferences.routes';
import clientAuthRoutes from '../src/modules/client/client.auth.routes';
import authRoutes from '../src/modules/auth/auth.routes';
import adminManagementRoutes from '../src/modules/admin/admin_management.routes';
import communicationsRoutes from '../src/modules/communications/communications.routes';
import clientCommunicationsRoutes from '../src/modules/client/client.communications.routes';

class FakeProvider implements EmailProvider {
  readonly name = 'fake';
  sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail) {
    this.sent.push(email);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

describe('email wiring: events, routes, preferences, unsubscribe', dbTest, () => {
  let app: TestApp;
  const secret = 'test-link-secret-'.padEnd(48, 'x');

  before(async () => {
    process.env.EMAIL_LINK_SECRET = secret;
    process.env.API_PUBLIC_URL = 'https://api.test';
    process.env.CLIENT_FRONTEND_URL = 'https://client.test';
    process.env.ADMIN_FRONTEND_URL = 'https://admin.test';
    initEmail();
    await resetDatabase();
    app = await startApp([
      ['/api/email', emailRoutes],
      ['/api/client/notification-preferences', clientPreferencesRoutes],
      ['/api/client/auth', clientAuthRoutes],
      ['/api/auth', authRoutes],
      ['/api/admin/admins', adminManagementRoutes],
      ['/api/admin/communications', communicationsRoutes],
      ['/api/client/communications', clientCommunicationsRoutes],
    ]);
  });
  beforeEach(async () => {
    await truncateAll();
    clearAdminAccountCache();
  });
  after(async () => {
    for (const k of ['EMAIL_LINK_SECRET', 'API_PUBLIC_URL', 'CLIENT_FRONTEND_URL', 'ADMIN_FRONTEND_URL', 'SUPPORT_EMAIL']) delete process.env[k];
    initEmail();
    await app?.close();
    await pool.end();
  });

  const emails = async () =>
    (await pool.query(`SELECT kind, to_address, admin_id, customer_id, notification_id::text, params, status, last_error, group_key FROM email_deliveries ORDER BY id`)).rows;
  const sendAll = async () => {
    await pool.query(`UPDATE email_deliveries SET send_after = NOW(), next_attempt_at = NOW() WHERE status = 'queued'`);
    const provider = new FakeProvider();
    await new EmailWorker({ pool, provider, config: { ...initEmail(), concurrency: 4 }, log: quiet }).drain();
    return provider.sent;
  };
  async function emitTx(event: NotificationEvent) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await emit(event, c);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  }
  const ref = (s: any, c: any) => ({ id: s.id, orderId: s.order_id, customerId: c.id });
  const statusEvent = (s: any, c: any, from: string, to: string, extra: Partial<{ reason: string | null; isCorrection: boolean; isReopen: boolean }> = {}) =>
    ({
      type: 'shipment.status_changed',
      actor: { type: 'admin', id: null },
      sourceId: `${s.id}-${from}-${to}-${Math.random()}`,
      shipment: ref(s, c),
      from,
      to,
      reason: extra.reason ?? null,
      isCorrection: extra.isCorrection ?? false,
      isReopen: extra.isReopen ?? false,
    }) as NotificationEvent;

  // ---------------------------------------------------------------- events
  describe('which events email', () => {
    test('shipment.created → admin.shipment_created to the same admins as the in-app rows (ops roles, active only)', async () => {
      const c = await insertCustomer({ isActive: true });
      const s = await insertShipment(c.id);
      const sa = await insertAdmin({ assignedRoles: ['super_admin'] });
      const mgr = await insertAdmin({ assignedRoles: ['manager'] });
      const log = await insertAdmin({ assignedRoles: ['logistics_officer'] });
      await insertAdmin({ assignedRoles: ['finance_officer'] });
      await insertAdmin({ assignedRoles: ['manager'], isActive: false });
      await emitTx({ type: 'shipment.created', actor: { type: 'customer', id: c.id }, sourceId: s.id, shipment: { ...ref(s, c), shippingMode: 'air_freight' } });
      const rows = await emails();
      assert.deepEqual(rows.map((r) => r.admin_id).sort(), [sa.id, mgr.id, log.id].sort());
      assert.ok(rows.every((r) => r.kind === 'admin.shipment_created' && r.notification_id && r.params.orderId === s.order_id));
      const inApp = (await pool.query(`SELECT id::text FROM notifications WHERE admin_id IS NOT NULL ORDER BY id`)).rows.map((r) => r.id);
      assert.deepEqual(rows.map((r) => r.notification_id).sort(), inApp.sort());
      // Re-emitting the same source event (dedupe) never emails twice.
      await emitTx({ type: 'shipment.created', actor: { type: 'customer', id: c.id }, sourceId: s.id, shipment: { ...ref(s, c), shippingMode: 'air_freight' } });
      assert.equal((await emails()).length, 3);
    });

    test('customer shipment emails: created_for_customer, in_transit/clearance/delivered/cancelled(+reason)/reopen and tracking; none for processing, corrections, same label, cancelled_by_client', async () => {
      const c = await insertCustomer({ isActive: true });
      const s = await insertShipment(c.id);
      await emitTx({ type: 'shipment.created_for_customer', actor: { type: 'admin', id: null }, sourceId: `cfc-${s.id}`, shipment: { ...ref(s, c), status: 'pending' } });
      await emitTx(statusEvent(s, c, 'pending', 'processing'));
      await emitTx(statusEvent(s, c, 'processing', 'in_transit'));
      await emitTx(statusEvent(s, c, 'in_transit', 'clearance'));
      await emitTx(statusEvent(s, c, 'clearance', 'in_transit', { isCorrection: true, reason: 'INTERNAL: wrong scan' }));
      await emitTx(statusEvent(s, c, 'clearance', 'delivered'));
      await emitTx(statusEvent(s, c, 'delivered', 'clearance', { isCorrection: true, isReopen: true, reason: 'INTERNAL' }));
      await emitTx(statusEvent(s, c, 'draft', 'pending'));
      await emitTx(statusEvent(s, c, 'processing', 'cancelled', { reason: 'Restricted goods' }));
      await emitTx(statusEvent(s, c, 'cancelled', 'pending', { isReopen: true, reason: 'Reopened after review' }));
      await emitTx({ type: 'shipment.tracking_assigned', actor: { type: 'admin', id: null }, sourceId: `trk-${s.id}`, shipment: ref(s, c), awbNumber: '176-1', bolNumber: null });
      await emitTx({ type: 'shipment.cancelled_by_client', actor: { type: 'customer', id: c.id }, sourceId: `cbc-${s.id}`, shipment: ref(s, c) });
      const rows = await emails();
      assert.deepEqual(
        rows.map((r) => [r.kind, r.params.to ?? r.params.status ?? r.params.awbNumber]),
        [
          ['customer.shipment_created', 'pending'],
          ['customer.shipment_status', 'in_transit'],
          ['customer.shipment_status', 'clearance'],
          ['customer.shipment_status', 'delivered'],
          ['customer.shipment_status', 'cancelled'],
          ['customer.shipment_status', 'pending'],
          ['customer.tracking_assigned', '176-1'],
        ]
      );
      assert.equal(rows[4].params.reason, 'Restricted goods', 'admin cancel reason (already shown in-app)');
      assert.equal(rows[5].params.reason, null, 'reopen reasons stay internal');
      assert.ok(!JSON.stringify(rows).includes('INTERNAL'), 'correction reasons never reach an email');
      assert.ok(rows.every((r) => r.customer_id === c.id && r.to_address === c.email && r.notification_id));
    });

    test('message.received: to_customer → grouped customer.message (also to leads); to_admins → support inbox only when configured', async () => {
      const lead = await insertCustomer({ isActive: false });
      const msg = (direction: 'to_admins' | 'to_customer', text: string) =>
        ({ type: 'message.received', actor: { type: direction === 'to_admins' ? 'customer' : 'admin', id: null }, sourceId: `m-${Math.random()}`, customerId: lead.id, direction, text, subject: 'Subj' }) as NotificationEvent;
      await emitTx(msg('to_admins', 'no inbox configured'));
      assert.equal((await emails()).length, 0, 'no SUPPORT_EMAIL/SMTP_USER → no support email (as before)');
      process.env.SUPPORT_EMAIL = 'support@vhi.test';
      initEmail();
      try {
        await emitTx(msg('to_admins', 'first'));
        await emitTx(msg('to_admins', 'second'));
        await emitTx(msg('to_customer', 'Hello lead'));
        const rows = await emails();
        assert.deepEqual(
          rows.map((r) => [r.kind, r.to_address, r.group_key, r.params.count, r.params.body]),
          [
            ['support.message', 'support@vhi.test', `msg:to_admins:${lead.id}`, 2, 'second'],
            ['customer.message', lead.email, `msg:to_customer:${lead.id}`, 1, 'Hello lead'],
          ]
        );
        const sent = await sendAll();
        assert.equal(sent.length, 2, 'the lead receives the message email');
        assert.ok(sent.find((e) => e.to === 'support@vhi.test')!.subject.startsWith('2 new messages from'));
      } finally {
        delete process.env.SUPPORT_EMAIL;
        initEmail();
      }
    });

    test('an opted-out customer still gets in-app notifications but no shipment email; service emails ignore the preference', async () => {
      const c = await insertCustomer({ isActive: true });
      const s = await insertShipment(c.id);
      await request(app, 'PUT', '/api/client/notification-preferences', { token: customerToken(c), body: { shipment_updates: false } });
      await emitTx(statusEvent(s, c, 'processing', 'in_transit'));
      await emitTx({ type: 'message.received', actor: { type: 'admin', id: null }, sourceId: 'm1', customerId: c.id, direction: 'to_customer', text: 'Still reaches you', subject: 'S' });
      const inApp = (await pool.query('SELECT type FROM notifications WHERE customer_id = $1 ORDER BY id', [c.id])).rows.map((r) => r.type);
      assert.deepEqual(inApp, ['shipment.status_changed', 'message.received']);
      const sent = await sendAll();
      assert.deepEqual(sent.map((e) => e.subject), ['New message from VHI: S']);
      const statuses = (await emails()).map((r) => [r.kind, r.status]);
      assert.deepEqual(statuses, [
        ['customer.shipment_status', 'cancelled'],
        ['customer.message', 'sent'],
      ]);
    });
  });

  // ---------------------------------------------------------------- existing + account emails through routes
  describe('emails sent by routes go through the outbox', () => {
    test('register (production only) queues the verification email with the stored token, in the same transaction', async () => {
      const body = { firstname: 'Ada', lastname: 'Obi', email: 'ada.prod@test.local', password: 'Secret-Pass-1', phone: '1' };
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      let res;
      try {
        res = await request(app, 'POST', '/api/client/auth/register', { body });
      } finally {
        process.env.NODE_ENV = prev;
      }
      assert.equal(res.status, 201);
      const [row] = await emails();
      assert.equal(row.kind, 'customer.verify_email');
      const token = (await pool.query('SELECT token FROM email_verification_tokens')).rows[0].token;
      assert.equal(row.params.token, token);
      const sent = await sendAll();
      assert.match(sent[0].text, new RegExp(`https://client\\.test/verify-email\\?token=${token}`));
      assert.ok(!('token' in (await emails())[0].params), 'token wiped after sending');

      const dev = await request(app, 'POST', '/api/client/auth/register', { body: { ...body, email: 'ada.dev@test.local' } });
      assert.equal(dev.status, 201);
      assert.equal((await emails()).length, 1, 'no verification email outside production (as before)');
    });

    test('forgot-password: repeated requests keep ONE queued email with the newest token; older tokens are invalidated; reset sends "password changed"', async () => {
      const c = await insertCustomer({ isActive: true });
      for (let i = 0; i < 3; i++) assert.equal((await request(app, 'POST', '/api/client/auth/forgot-password', { body: { email: c.email } })).status, 200);
      const tokens = (await pool.query(`SELECT token FROM email_verification_tokens WHERE type = 'password_reset'`)).rows;
      assert.equal(tokens.length, 1, 'only the newest reset token is valid');
      const rows = await emails();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].kind, 'customer.password_reset');
      assert.equal(rows[0].params.token, tokens[0].token, 'the queued email carries the newest token');
      const sent = await sendAll();
      assert.ok(sent[0].text.includes(`/reset-password?token=${tokens[0].token}`));

      const reset = await request(app, 'POST', '/api/client/auth/reset-password', { body: { token: tokens[0].token, password: 'New-Pass-123' } });
      assert.equal(reset.status, 200);
      const after = await emails();
      assert.equal(after[1].kind, 'customer.password_changed');
      assert.equal(after[1].customer_id, c.id);
    });

    test('admin → customer and customer → support messages are queued (full body) and sent by the worker', async () => {
      process.env.SUPPORT_EMAIL = 'support@vhi.test';
      initEmail();
      try {
        const admin = await insertAdmin({ assignedRoles: ['super_admin'] });
        const c = await insertCustomer({ isActive: true });
        const body = 'Line one\nLine two <b>not bold</b>';
        assert.equal((await request(app, 'POST', '/api/admin/communications/send', { token: adminToken({ ...admin, activeRole: 'super_admin' }), body: { customerId: c.id, subject: 'Pickup', body } })).status, 201);
        assert.equal((await request(app, 'POST', '/api/client/communications/send', { token: customerToken(c), body: { subject: 'Question', body } })).status, 201);
        const sent = await sendAll();
        const toCustomer = sent.find((e) => e.to === c.email)!;
        const toSupport = sent.find((e) => e.to === 'support@vhi.test')!;
        assert.equal(toCustomer.subject, 'New message from VHI: Pickup');
        assert.ok(toCustomer.text.includes('> Line one\n> Line two <b>not bold</b>'), 'full message in the text part');
        assert.ok(toCustomer.html.includes('Line two &lt;b&gt;not bold&lt;/b&gt;'), 'escaped in HTML');
        assert.ok(toCustomer.html.includes('https://client.test/dashboard/mail'), 'R-25: real client mail route');
        assert.ok(toSupport.html.includes(`https://admin.test/admin/communications?selected=${c.id}`));
        assert.ok((await emails()).every((r) => !('body' in r.params)), 'bodies wiped after sending');
      } finally {
        delete process.env.SUPPORT_EMAIL;
        initEmail();
      }
    });

    test('account emails: roles changed (only on a real change), deactivation (not reactivation), reset by super admin (no password in the email), own password change', async () => {
      const sa = await insertAdmin({ assignedRoles: ['super_admin'] });
      const saToken = adminToken({ ...sa, activeRole: 'super_admin' });
      const target = await insertAdmin({ assignedRoles: ['manager'] });
      const put = (p: string, body: unknown) => request(app, 'PUT', `/api/admin/admins/${target.id}${p}`, { token: saToken, body });

      assert.equal((await put('/roles', { assignedRoles: ['manager'] })).status, 200);
      assert.equal((await emails()).length, 0, 'same roles → no email');
      assert.equal((await put('/roles', { assignedRoles: ['manager', 'logistics_officer'] })).status, 200);
      assert.equal((await put('/status', { isActive: false })).status, 200);
      assert.equal((await put('/status', { isActive: true })).status, 200);
      const reset = await request(app, 'POST', `/api/admin/admins/${target.id}/reset-password`, { token: saToken, body: {} });
      assert.equal(reset.status, 200);
      const temp = reset.body.data.tempPassword;

      await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [await bcrypt.hash('Old-Pass-1', 4), sa.id]);
      clearAdminAccountCache();
      assert.equal((await request(app, 'PUT', '/api/auth/admin/change-password', { token: saToken, body: { currentPassword: 'Old-Pass-1', newPassword: 'New-Pass-2' } })).status, 200);

      const rows = await emails();
      assert.deepEqual(rows.map((r) => [r.kind, r.admin_id]), [
        ['admin.roles_changed', target.id],
        ['admin.deactivated', target.id],
        ['admin.password_reset_by_admin', target.id],
        ['admin.password_changed', sa.id],
      ]);
      assert.deepEqual(rows[0].params.roles, ['manager', 'logistics_officer']);
      const sent = await sendAll();
      const resetMail = sent.find((e) => e.subject === 'Your VHI CRM password was reset')!;
      assert.ok(!resetMail.text.includes(temp) && !resetMail.html.includes(temp), 'the temporary password is never emailed');
      assert.ok(!JSON.stringify(rows).includes(temp));
      const audit = (await pool.query(`SELECT action FROM audit_logs ORDER BY created_at`)).rows.map((r) => r.action);
      for (const a of ['UPDATE_ADMIN_ROLES', 'TOGGLE_ADMIN_STATUS', 'RESET_ADMIN_PASSWORD', 'CHANGE_PASSWORD']) assert.ok(audit.includes(a), a);
    });
  });

  // ---------------------------------------------------------------- preferences
  describe('preferences', () => {
    test('client: defaults on; PUT validates (unknown key, non-boolean, empty → 400) and only touches the caller', async () => {
      const a = await insertCustomer({ isActive: true });
      const b = await insertCustomer({ isActive: true });
      const get = (c: any) => request(app, 'GET', '/api/client/notification-preferences', { token: customerToken(c) });
      const put = (c: any, body: unknown) => request(app, 'PUT', '/api/client/notification-preferences', { token: customerToken(c), body });
      assert.deepEqual((await get(a)).body.data, { shipment_updates: true });
      assert.equal((await put(a, { shipment_updates: false, marketing: true })).status, 400);
      assert.equal((await put(a, { shipment_updates: 'no' })).status, 400);
      assert.equal((await put(a, {})).status, 400);
      assert.equal((await put(a, { shipment_updates: false })).status, 200);
      assert.deepEqual((await get(a)).body.data, { shipment_updates: false });
      assert.deepEqual((await get(b)).body.data, { shipment_updates: true });
      assert.equal((await request(app, 'GET', '/api/client/notification-preferences')).status, 401);
    });

    test('admin: GET normalises unreadable stored JSON; PUT rejects unknown keys, accepts the old 7-key body and merges partial updates', async () => {
      const admin = await insertAdmin({ assignedRoles: ['manager'] });
      const token = adminToken({ ...admin, activeRole: 'manager' });
      await pool.query(`UPDATE admins SET notification_prefs = '[1,2]' WHERE id = $1`, [admin.id]);
      const get = () => request(app, 'GET', '/api/auth/admin/notification-preferences', { token });
      const put = (notificationPrefs: unknown) => request(app, 'PUT', '/api/auth/admin/notification-preferences', { token, body: { notificationPrefs } });
      const first = await get();
      assert.equal(first.status, 200);
      assert.equal(first.body.data.prefs.shipment_created, true);
      assert.equal(first.body.data.prefs.newsletter_sent, false);
      assert.deepEqual(first.body.data.emailKeys, ['shipment_created']);
      assert.equal((await put({ shipment_created: false, nonsense: true })).status, 400);
      assert.equal((await put({ shipment_created: 'off' })).status, 400);
      const legacy = { registration: false, shipment_created: true, status_updated: true, invoice_created: true, payment_received: true, overdue_alert: true, newsletter_sent: false };
      assert.equal((await put(legacy)).status, 200, 'the current Settings page body is still accepted');
      assert.equal((await put({ shipment_created: false })).status, 200);
      const merged = (await get()).body.data.prefs;
      assert.equal(merged.shipment_created, false);
      assert.equal(merged.registration, false, 'a partial update keeps the other saved keys');
    });
  });

  // ---------------------------------------------------------------- unsubscribe
  describe('unsubscribe', () => {
    const page = (method: 'GET' | 'POST', token: string, init: RequestInit = {}) =>
      fetch(`${app.url}/api/email/unsubscribe?token=${encodeURIComponent(token)}`, { method, ...init });
    const prefsOf = async (id: string) => (await pool.query('SELECT notification_prefs FROM customers WHERE id = $1', [id])).rows[0].notification_prefs;
    const tokenFor = (c: any, issuedAt = new Date()) => createUnsubscribeToken({ customerId: c.id, prefKey: 'shipment_updates', issuedAt }, secret);

    test('GET shows a confirmation page and never changes anything; POST unsubscribes, idempotently, with one audit row', async () => {
      const c = await insertCustomer({ isActive: true });
      const token = tokenFor(c);
      for (let i = 0; i < 2; i++) {
        const res = await page('GET', token);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('<form method="post"'));
        assert.ok(!html.includes(c.email), 'email is masked');
        assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
        assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
        assert.equal(res.headers.get('cache-control'), 'no-store');
      }
      assert.deepEqual(await prefsOf(c.id), {}, 'GET changed nothing');
      for (let i = 0; i < 2; i++) assert.equal((await page('POST', token)).status, 200);
      assert.deepEqual(await prefsOf(c.id), { shipment_updates: false });
      const audits = (await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'EMAIL_UNSUBSCRIBE'`)).rows[0].n;
      assert.equal(audits, 1);
    });

    test('RFC 8058 one-click POST (form body, token in the URL) works', async () => {
      const c = await insertCustomer({ isActive: true });
      const res = await page('POST', tokenFor(c), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
      assert.equal(res.status, 200);
      assert.deepEqual(await prefsOf(c.id), { shipment_updates: false });
    });

    test('tampered, expired, wrong-secret and garbage tokens are rejected (400) and change nothing; a token only affects its own customer', async () => {
      const a = await insertCustomer({ isActive: true });
      const b = await insertCustomer({ isActive: true });
      const good = tokenFor(a);
      const [payload, sig] = good.split('.');
      const forged = Buffer.from(JSON.stringify({ c: b.id, k: 'shipment_updates', t: Math.floor(Date.now() / 1000) })).toString('base64url');
      const bad = [
        `${forged}.${sig}`, // B's id with A's signature
        `${payload}.${sig.slice(0, -2)}${sig.slice(-2) === 'AA' ? 'AB' : 'AA'}`,
        tokenFor(a, new Date(Date.now() - 91 * 24 * 60 * 60 * 1000)),
        createUnsubscribeToken({ customerId: a.id, prefKey: 'shipment_updates', issuedAt: new Date() }, 'another-secret'.padEnd(40, 'y')),
        'garbage',
        '',
      ];
      for (const t of bad) {
        assert.equal((await page('GET', t)).status, 400, `GET ${t.slice(0, 20)}`);
        assert.equal((await page('POST', t)).status, 400, `POST ${t.slice(0, 20)}`);
      }
      assert.deepEqual(await prefsOf(a.id), {});
      assert.deepEqual(await prefsOf(b.id), {});
      assert.equal((await page('POST', good)).status, 200);
      assert.deepEqual(await prefsOf(a.id), { shipment_updates: false });
      assert.deepEqual(await prefsOf(b.id), {}, 'only the token owner is affected');
    });
  });
});
