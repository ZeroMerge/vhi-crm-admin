import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Webhook } from 'standardwebhooks'; // test-only cross-check (transitive dependency of `resend`)
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin, insertCustomer } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import { errorHandler } from '../src/middleware/errorHandler';
import { initEmail } from '../src/modules/email';
import { emailConfigFromEnv, EmailConfigError } from '../src/modules/email/config';
import { enqueueEmail } from '../src/modules/email/outbox';
import { EmailWorker } from '../src/modules/email/worker';
import type { EmailProvider, OutgoingEmail } from '../src/modules/email/provider';
import { signWebhook, verifyWebhook, webhookKey } from '../src/modules/webhooks/signature';
import resendWebhookRoutes from '../src/modules/webhooks/resend.routes';
import customersRoutes from '../src/modules/customers/customers.routes';

const SECRET = `whsec_${crypto.randomBytes(24).toString('base64')}`;
const OTHER_SECRET = `whsec_${crypto.randomBytes(24).toString('base64')}`;
const KEY = webhookKey(SECRET);
const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const BASES = { client: 'https://client.test', admin: 'https://admin.test', api: 'https://api.test' };

describe('webhook signature (Svix / Standard Webhooks)', () => {
  const body = Buffer.from('{"type":"email.bounced"}');
  const now = 1_790_000_000;
  const ts = String(now);

  test('our signature equals the standardwebhooks implementation', () => {
    const theirs = new Webhook(SECRET).sign('msg_1', new Date(now * 1000), body.toString());
    assert.equal(theirs, `v1,${signWebhook(KEY, 'msg_1', ts, body)}`);
    // And theirs verifies ours.
    new Webhook(SECRET).verify(body.toString(), { 'webhook-id': 'msg_1', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': `v1,${signWebhook(KEY, 'msg_1', String(Math.floor(Date.now() / 1000)), body)}` });
  });

  test('valid; any of several v1 signatures; other versions ignored', () => {
    const good = signWebhook(KEY, 'msg_1', ts, body);
    const v = (signature: string) => verifyWebhook({ key: KEY, id: 'msg_1', timestamp: ts, signature, body, nowSeconds: now });
    assert.deepEqual(v(`v1,${good}`), { ok: true });
    assert.deepEqual(v(`v1,${Buffer.alloc(32).toString('base64')} v1,${good}`), { ok: true });
    assert.equal(v(`v2,${good}`).ok, false);
    assert.equal(v('v1,').ok, false);
    assert.equal(v(`v1,${good.slice(0, 10)}`).ok, false, 'a truncated signature never throws in timingSafeEqual');
  });

  test('tampered body, wrong secret, missing headers, old and future timestamps', () => {
    const good = `v1,${signWebhook(KEY, 'msg_1', ts, body)}`;
    const base = { key: KEY, id: 'msg_1', timestamp: ts, signature: good, body, nowSeconds: now };
    assert.deepEqual(verifyWebhook({ ...base, body: Buffer.from('{"type":"email.complained"}') }), { ok: false, status: 401, reason: 'no matching signature' });
    assert.equal((verifyWebhook({ ...base, key: webhookKey(OTHER_SECRET) }) as { status: number }).status, 401);
    assert.equal((verifyWebhook({ ...base, id: 'msg_2' }) as { status: number }).status, 401, 'the id is signed too');
    assert.equal((verifyWebhook({ ...base, signature: undefined }) as { status: number }).status, 400);
    assert.equal((verifyWebhook({ ...base, id: undefined }) as { status: number }).status, 400);
    assert.equal((verifyWebhook({ ...base, nowSeconds: now + 301 }) as { status: number }).status, 400, 'too old');
    assert.equal((verifyWebhook({ ...base, nowSeconds: now - 301 }) as { status: number }).status, 400, 'from the future');
    assert.deepEqual(verifyWebhook({ ...base, nowSeconds: now + 299 }), { ok: true });
    assert.equal((verifyWebhook({ ...base, timestamp: '17e8' }) as { status: number }).status, 400);
  });

  test('config: secret format checked; required in production with resend; optional otherwise', () => {
    const prod = { NODE_ENV: 'production', RESEND_API_KEY: 're_x', EMAIL_LINK_SECRET: 'x'.repeat(40), API_PUBLIC_URL: 'https://api.test', CLIENT_FRONTEND_URL: 'https://c.test', ADMIN_FRONTEND_URL: 'https://a.test' };
    assert.throws(() => emailConfigFromEnv(prod), (e: unknown) => e instanceof EmailConfigError && e.message.includes('RESEND_WEBHOOK_SECRET is required'));
    assert.equal(emailConfigFromEnv({ ...prod, RESEND_WEBHOOK_SECRET: SECRET }).resendWebhookSecret, SECRET);
    assert.equal(emailConfigFromEnv({ ...prod, EMAIL_PROVIDER: 'console' }).resendWebhookSecret, null);
    assert.throws(() => emailConfigFromEnv({ NODE_ENV: 'development', RESEND_WEBHOOK_SECRET: 'not-a-secret' }), /RESEND_WEBHOOK_SECRET must start with "whsec_"/);
    assert.throws(() => emailConfigFromEnv({ NODE_ENV: 'development', RESEND_WEBHOOK_SECRET: 'whsec_abc' }), /fewer than 16 bytes/);
    assert.equal(emailConfigFromEnv({ NODE_ENV: 'development' }).resendWebhookSecret, null);
  });

  test('src/index.ts mounts the webhook before CORS and express.json()', () => {
    const index = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
    const mount = index.indexOf("app.use('/api/webhooks', resendWebhookRoutes)");
    assert.ok(mount > 0);
    assert.ok(mount < index.indexOf('app.use(cors('));
    assert.ok(mount < index.indexOf('app.use(express.json())'));
  });
});

class FakeProvider implements EmailProvider {
  readonly name = 'fake';
  sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail) {
    this.sent.push(email);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}

describe('POST /api/webhooks/resend', dbTest, () => {
  let server: Server;
  let url: string;
  let adminApp: TestApp;

  before(async () => {
    await resetDatabase();
    // Same order as src/index.ts: the webhook router before express.json().
    const app = express();
    app.use('/api/webhooks', resendWebhookRoutes);
    app.use(express.json());
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/resend`;
    adminApp = await startApp([['/api/admin/customers', customersRoutes]]);
  });
  beforeEach(async () => {
    await truncateAll();
    clearAdminAccountCache();
    initEmail({ NODE_ENV: 'test', RESEND_WEBHOOK_SECRET: SECRET });
  });
  after(async () => {
    initEmail({ NODE_ENV: 'test' });
    await new Promise((r) => server.close(r));
    await adminApp?.close();
    await pool.end();
  });

  let seq = 0;
  async function post(event: unknown, options: { id?: string; secret?: string; timestamp?: number; body?: string } = {}) {
    const id = options.id ?? `msg_${Date.now()}_${seq++}`;
    const ts = String(options.timestamp ?? Math.floor(Date.now() / 1000));
    const raw = JSON.stringify(event);
    const signature = `v1,${signWebhook(webhookKey(options.secret ?? SECRET), id, ts, raw)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature },
      body: options.body ?? raw,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, id };
  }
  const bounce = (to: string[], type = 'Permanent') => ({ type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: 'e1', to, bounce: { type, subType: 'General', message: 'mailbox does not exist' } } });
  const complaint = (to: string[]) => ({ type: 'email.complained', created_at: new Date().toISOString(), data: { email_id: 'e2', to } });
  const suppressions = async () => (await pool.query('SELECT address, reason FROM email_suppressions ORDER BY address')).rows;
  const counts = async () =>
    (await pool.query(`SELECT (SELECT COUNT(*)::int FROM processed_webhooks) AS webhooks, (SELECT COUNT(*)::int FROM email_suppressions) AS suppressions, (SELECT COUNT(*)::int FROM notifications) AS notifications`)).rows[0];

  test('no RESEND_WEBHOOK_SECRET: 503 and nothing processed, even for a correctly signed request', async () => {
    initEmail({ NODE_ENV: 'test' });
    await insertAdmin({ assignedRoles: ['crm_officer'] });
    const c = await insertCustomer();
    const res = await post(bounce([c.email]));
    assert.equal(res.status, 503);
    assert.deepEqual(await counts(), { webhooks: 0, suppressions: 0, notifications: 0 });
  });

  test('rejected requests change nothing: tampered body, wrong secret, missing signature, stale timestamp', async () => {
    const c = await insertCustomer();
    const signed = JSON.stringify(bounce([c.email]));
    assert.equal((await post(bounce(['someone-else@test.local']), { body: signed.replace('Permanent', 'Transient') })).status, 401);
    assert.equal((await post(bounce([c.email]), { secret: OTHER_SECRET })).status, 401);
    assert.equal((await post(bounce([c.email]), { timestamp: Math.floor(Date.now() / 1000) - 600 })).status, 400);
    assert.equal((await post(bounce([c.email]), { timestamp: Math.floor(Date.now() / 1000) + 600 })).status, 400);
    const unsigned = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: signed });
    assert.equal(unsigned.status, 400);
    assert.deepEqual(await counts(), { webhooks: 0, suppressions: 0, notifications: 0 });
  });

  test('permanent bounce: suppressed (case-insensitive), contact staff alerted in-app; replay processed once', async () => {
    const crm = await insertAdmin({ assignedRoles: ['crm_officer'] });
    const support = await insertAdmin({ assignedRoles: ['support_staff'] });
    await insertAdmin({ assignedRoles: ['logistics_officer'] });
    const c = await insertCustomer();
    const res = await post(bounce([c.email.toUpperCase()]));
    assert.equal(res.status, 200);
    assert.deepEqual(await suppressions(), [{ address: c.email.toLowerCase(), reason: 'bounce' }]);
    const rows = (await pool.query(`SELECT admin_id, title, body, entity_type, entity_id FROM notifications WHERE type = 'email.bounced' ORDER BY admin_id`)).rows;
    assert.deepEqual(new Set(rows.map((r) => r.admin_id)), new Set([crm.id, support.id]));
    assert.equal(rows[0].title, 'Email to Test Customer bounced');
    assert.equal(rows[0].body, `${c.email} rejected our email. Update the address so they get account and shipment emails.`);
    assert.deepEqual([rows[0].entity_type, rows[0].entity_id], ['customer', c.id]);

    const replay = await post(bounce([c.email]), { id: res.id });
    assert.deepEqual([replay.status, replay.body.duplicate], [200, true]);
    assert.equal((await counts()).notifications, 2);
  });

  test('transient bounce: log only; admin address bounce: suppressed, no alert; other events ignored', async () => {
    await insertAdmin({ assignedRoles: ['crm_officer'] });
    const admin = await insertAdmin({ assignedRoles: ['manager'] });
    const c = await insertCustomer();
    const original = console.warn;
    const log = console.log;
    console.warn = () => {};
    console.log = () => {};
    try {
      assert.equal((await post(bounce([c.email], 'Transient'))).status, 200);
      assert.deepEqual(await suppressions(), []);
      assert.equal((await post(bounce([admin.email]))).status, 200);
      assert.equal((await post({ type: 'email.delivered', data: { to: [c.email] } })).status, 200);
    } finally {
      console.warn = original;
      console.log = log;
    }
    assert.deepEqual(await suppressions(), [{ address: admin.email, reason: 'bounce' }]);
    assert.equal((await counts()).notifications, 0);
    assert.equal((await counts()).webhooks, 3);
  });

  test('complaint: suppressed as complaint and shipment emails switched off; a bounce upgrades it, a complaint never downgrades', async () => {
    const c = await insertCustomer();
    await pool.query(`UPDATE customers SET notification_prefs = '{"shipment_updates": true}' WHERE id = $1`, [c.id]);
    assert.equal((await post(complaint([c.email]))).status, 200);
    assert.deepEqual(await suppressions(), [{ address: c.email, reason: 'complaint' }]);
    assert.equal((await pool.query('SELECT notification_prefs FROM customers WHERE id = $1', [c.id])).rows[0].notification_prefs.shipment_updates, false);
    await post(bounce([c.email]));
    assert.deepEqual(await suppressions(), [{ address: c.email, reason: 'bounce' }]);
    await post(complaint([c.email]));
    assert.deepEqual(await suppressions(), [{ address: c.email, reason: 'bounce' }]);
  });

  test('the worker honours suppressions: bounce cancels everything; complaint cancels preference emails, service emails still go', async () => {
    const bounced = await insertCustomer();
    const complained = await insertCustomer();
    await pool.query(`INSERT INTO email_suppressions (address, reason) VALUES ($1, 'bounce'), ($2, 'complaint')`, [bounced.email, complained.email]);
    const c = await pool.connect();
    try {
      for (const cust of [bounced, complained]) {
        await enqueueEmail(c, { kind: 'customer.shipment_status', to: cust.email.toUpperCase(), customerId: cust.id, params: { firstname: 'T', orderId: 'O1', to: 'delivered' } });
        await enqueueEmail(c, { kind: 'customer.password_changed', to: cust.email, customerId: cust.id, params: { firstname: 'T' } });
      }
    } finally {
      c.release();
    }
    const provider = new FakeProvider();
    await new EmailWorker({ pool, provider, log: quiet, config: { from: 'VHI <n@test.local>', replyTo: null, linkSecret: 'x'.repeat(64), bases: BASES, concurrency: 4 } }).drain();
    const rows = (await pool.query('SELECT kind, to_address, status, last_error FROM email_deliveries ORDER BY id')).rows;
    assert.deepEqual(
      rows.map((r) => [r.kind, r.status, r.last_error]),
      [
        ['customer.shipment_status', 'cancelled', 'address is suppressed: it bounced'],
        ['customer.password_changed', 'cancelled', 'address is suppressed: it bounced'],
        ['customer.shipment_status', 'cancelled', 'address is suppressed: the recipient marked our email as spam'],
        ['customer.password_changed', 'sent', null],
      ]
    );
    assert.deepEqual(provider.sent.map((e) => e.to), [complained.email]);
  });

  test('changing a customer address removes the suppression for the NEW address only', async () => {
    const admin = await insertAdmin({ assignedRoles: ['super_admin'] });
    const token = adminToken({ ...admin, activeRole: 'super_admin' });
    const c = await insertCustomer();
    await pool.query(`INSERT INTO email_suppressions (address, reason) VALUES ($1, 'bounce'), ('fixed@test.local', 'complaint')`, [c.email]);
    const body = { firstname: 'Test', lastname: 'Customer', email: 'Fixed@Test.local', phone: null, industry: null, status: 'lead' };
    const res = await request(adminApp, 'PUT', `/api/admin/customers/${c.id}`, { token, body });
    assert.equal(res.status, 200);
    assert.deepEqual(await suppressions(), [{ address: c.email, reason: 'bounce' }]);
    // Saving again without an address change touches nothing.
    await pool.query(`INSERT INTO email_suppressions (address, reason) VALUES ('fixed@test.local', 'bounce')`);
    assert.equal((await request(adminApp, 'PUT', `/api/admin/customers/${c.id}`, { token, body })).status, 200);
    assert.equal((await suppressions()).length, 2);
  });
});
