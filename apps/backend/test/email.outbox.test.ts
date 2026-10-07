import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { spawnSync } from 'child_process';
import { Client } from 'pg';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { insertAdmin, insertCustomer } from './helpers/fixtures';
import pool from '../src/config/db';
import { enqueueEmail, EMAIL_CHANNEL } from '../src/modules/email/outbox';
import { EmailWorker, RETRY_DELAYS_MS, MAX_ATTEMPTS } from '../src/modules/email/worker';
import { EmailProvider, EmailSendError, OutgoingEmail } from '../src/modules/email/provider';
import { emailConfigFromEnv, EmailConfigError, LEGACY_FROM } from '../src/modules/email/config';
import { classifyResendError } from '../src/modules/email/resendProvider';
import { ConsoleProvider } from '../src/modules/email/consoleProvider';
import { createProvider } from '../src/modules/email';

const CONFIG = {
  from: 'VHI <noreply@test.local>',
  replyTo: 'support@test.local',
  linkSecret: 'x'.repeat(64),
  bases: { client: 'https://client.test', admin: 'https://admin.test', api: 'https://api.test' },
  concurrency: 2,
};
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

/** Records every send; `script` decides each attempt's result (default success). */
class FakeProvider implements EmailProvider {
  readonly name = 'fake';
  sent: OutgoingEmail[] = [];
  script: Array<(e: OutgoingEmail) => void> = [];
  delayMs = 0;
  async send(email: OutgoingEmail) {
    this.sent.push(email);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const step = this.script.shift();
    if (step) step(email);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
const worker = (provider: EmailProvider, extra: Partial<typeof CONFIG> = {}) =>
  new EmailWorker({ pool, provider, config: { ...CONFIG, ...extra }, log: quiet });

async function inTx<T>(fn: (c: import('pg').PoolClient) => Promise<T>, commit = true): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}
const rowsOf = async () =>
  (await pool.query(`SELECT id::text, kind, status, attempts, params, last_error, next_attempt_at, send_after, idempotency_key::text, provider_message_id FROM email_deliveries ORDER BY id`)).rows;
const makeDue = () => pool.query(`UPDATE email_deliveries SET send_after = NOW() - interval '1 second', next_attempt_at = NOW() - interval '1 second' WHERE status = 'queued'`);

describe('email outbox and worker', dbTest, () => {
  before(async () => {
    await resetDatabase();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  after(async () => {
    await pool.end();
  });

  const verifyFor = async (customer: { id: string; email: string }, c: import('pg').PoolClient) =>
    enqueueEmail(c, { kind: 'customer.verify_email', to: customer.email, customerId: customer.id, params: { firstname: 'Ada', token: 'tok-1' } });

  test('enqueue on the caller transaction: rollback → no row and no wake-up; commit → row, wake-up, and the worker sends', async () => {
    const listener = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await listener.connect();
    let wakes = 0;
    listener.on('notification', (m) => {
      if (m.channel === EMAIL_CHANNEL) wakes++;
    });
    await listener.query(`LISTEN ${EMAIL_CHANNEL}`);
    try {
      const customer = await insertCustomer({ isActive: false });
      await inTx((c) => verifyFor(customer, c), false);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal((await rowsOf()).length, 0);
      assert.equal(wakes, 0, 'no wake-up for a rolled-back enqueue');

      await inTx((c) => verifyFor(customer, c));
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(wakes, 1, 'wake-up delivered on COMMIT');
      const provider = new FakeProvider();
      await worker(provider).drain();
      assert.equal(provider.sent.length, 1);
      assert.equal(provider.sent[0].to, customer.email);
      assert.equal(provider.sent[0].subject, 'Verify your VHI account');
      assert.match(provider.sent[0].text, /https:\/\/client\.test\/verify-email\?token=tok-1/);
      const [row] = await rowsOf();
      assert.equal(row.status, 'sent');
      assert.equal(row.provider_message_id, 'fake-1');
      assert.equal(provider.sent[0].idempotencyKey, row.idempotency_key, 'the row UUID is the idempotency key');
      assert.ok(!('token' in row.params), 'token wiped when sent');
    } finally {
      await listener.end();
    }
  });

  test('two workers never send the same row (FOR UPDATE SKIP LOCKED)', async () => {
    const customer = await insertCustomer({ isActive: true });
    await inTx(async (c) => {
      for (let i = 0; i < 12; i++) {
        await enqueueEmail(c, { kind: 'customer.password_changed', to: customer.email, customerId: customer.id, params: { firstname: `n${i}` } });
      }
    });
    const a = new FakeProvider();
    const b = new FakeProvider();
    a.delayMs = b.delayMs = 15;
    await Promise.all([worker(a).drain(), worker(b).drain()]);
    const keys = [...a.sent, ...b.sent].map((e) => e.idempotencyKey);
    assert.equal(keys.length, 12, 'every row sent exactly once');
    assert.equal(new Set(keys).size, 12);
    assert.ok(a.sent.length > 0 && b.sent.length > 0, 'both workers took part');
    assert.ok((await rowsOf()).every((r) => r.status === 'sent'));
  });

  test('retryable failures back off 1m, 5m, 30m, 2h, 6h, then the row fails; retries render identically with the same key', async () => {
    const customer = await insertCustomer({ isActive: true });
    await inTx((c) =>
      enqueueEmail(c, { kind: 'customer.message', to: customer.email, customerId: customer.id, params: { firstname: 'Ada', count: 1, hasPortal: true, messages: [{ sentAt: '2026-10-06T14:00:00.000Z', subject: 'S', body: 'Full body\nline 2' }] } })
    );
    const provider = new FakeProvider();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      provider.script.push(() => {
        throw new EmailSendError('retryable', 'temporary');
      });
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const before = Date.now();
      await worker(provider).drain();
      const [row] = await rowsOf();
      assert.equal(row.attempts, attempt);
      if (attempt < MAX_ATTEMPTS) {
        assert.equal(row.status, 'queued', `attempt ${attempt}`);
        const delay = new Date(row.next_attempt_at).getTime() - before;
        assert.ok(Math.abs(delay - RETRY_DELAYS_MS[attempt - 1]) < 5000, `attempt ${attempt}: next try in ~${RETRY_DELAYS_MS[attempt - 1]}ms (got ${delay})`);
        assert.equal(row.params.messages[0].body, 'Full body\nline 2', 'message kept while the row is still pending');
        await makeDue();
      } else {
        assert.equal(row.status, 'failed');
        assert.match(row.last_error, /gave up after 6 attempts/);
        assert.ok(!('messages' in row.params), 'messages wiped when failed');
      }
    }
    assert.equal(provider.sent.length, MAX_ATTEMPTS);
    const first = provider.sent[0];
    for (const later of provider.sent.slice(1)) {
      assert.equal(later.idempotencyKey, first.idempotencyKey);
      assert.equal(later.subject, first.subject);
      assert.equal(later.html, first.html);
      assert.equal(later.text, first.text);
    }
  });

  test('permanent failure fails at once; rate_limited honours retryAfter and does not use up an attempt', async () => {
    const customer = await insertCustomer({ isActive: true });
    await inTx(async (c) => {
      await enqueueEmail(c, { kind: 'customer.password_changed', to: customer.email, customerId: customer.id, params: { firstname: 'P' } });
      await enqueueEmail(c, { kind: 'customer.password_changed', to: customer.email, customerId: customer.id, params: { firstname: 'R' } });
    });
    const provider = new FakeProvider();
    provider.script.push(() => {
      throw new EmailSendError('permanent', 'invalid_from_address');
    });
    provider.script.push(() => {
      throw new EmailSendError('rate_limited', 'slow down', 120_000);
    });
    const before = Date.now();
    await worker(provider, { concurrency: 1 }).drain();
    const [permanent, limited] = await rowsOf();
    assert.equal(permanent.status, 'failed');
    assert.equal(permanent.attempts, 1);
    assert.match(permanent.last_error, /invalid_from_address/);
    assert.equal(limited.status, 'queued');
    assert.equal(limited.attempts, 0, 'rate limiting is not counted as an attempt');
    const delay = new Date(limited.next_attempt_at).getTime() - before;
    assert.ok(delay > 115_000 && delay < 125_000, `retry after ~120s (got ${delay})`);
  });

  test('stale "sending" rows (worker died) go back to the queue after 10 minutes and are sent with the same key', async () => {
    const customer = await insertCustomer({ isActive: true });
    await inTx((c) => enqueueEmail(c, { kind: 'customer.password_changed', to: customer.email, customerId: customer.id, params: { firstname: 'S' } }));
    await pool.query(`UPDATE email_deliveries SET status = 'sending', attempts = 1, locked_at = NOW() - interval '9 minutes'`);
    const provider = new FakeProvider();
    await worker(provider).drain();
    assert.equal(provider.sent.length, 0, 'not stale yet at 9 minutes');
    await pool.query(`UPDATE email_deliveries SET locked_at = NOW() - interval '11 minutes'`);
    await worker(provider).drain();
    assert.equal(provider.sent.length, 1);
    const [row] = await rowsOf();
    assert.equal(row.status, 'sent');
    assert.equal(provider.sent[0].idempotencyKey, row.idempotency_key);
  });

  test('send-time checks: opted out → cancelled; inactive customer → cancelled (shipment/password); leads still get messages; verify to an active account → cancelled', async () => {
    const active = await insertCustomer({ isActive: true });
    const lead = await insertCustomer({ isActive: false });
    await inTx(async (c) => {
      await enqueueEmail(c, { kind: 'customer.shipment_created', to: active.email, customerId: active.id, params: { firstname: 'A', orderId: 'O1', status: 'pending' } });
      await enqueueEmail(c, { kind: 'customer.shipment_created', to: lead.email, customerId: lead.id, params: { firstname: 'L', orderId: 'O2', status: 'pending' } });
      await enqueueEmail(c, { kind: 'customer.password_changed', to: lead.email, customerId: lead.id, params: { firstname: 'L' } });
      await enqueueEmail(c, { kind: 'customer.message', to: lead.email, customerId: lead.id, params: { firstname: 'L', count: 1, hasPortal: false, messages: [{ sentAt: '2026-10-06T14:00:00.000Z', subject: 'Hi', body: 'Body for a lead' }] } });
      await enqueueEmail(c, { kind: 'customer.verify_email', to: active.email, customerId: active.id, params: { firstname: 'A', token: 't' } });
    });
    // The customer opts out AFTER the email was queued.
    await pool.query(`UPDATE customers SET notification_prefs = '{"shipment_updates": false}' WHERE id = $1`, [active.id]);
    const provider = new FakeProvider();
    await worker(provider).drain();
    const rows = await rowsOf();
    assert.deepEqual(
      rows.map((r) => [r.kind, r.status, r.last_error]),
      [
        ['customer.shipment_created', 'cancelled', 'customer turned off shipment update emails'],
        ['customer.shipment_created', 'cancelled', 'customer is not active'],
        ['customer.password_changed', 'cancelled', 'customer is not active'],
        ['customer.message', 'sent', null],
        ['customer.verify_email', 'cancelled', 'account already verified'],
      ]
    );
    assert.equal(provider.sent.length, 1);
    assert.ok(rows.every((r) => !('messages' in r.params) && !('token' in r.params)), 'messages/token wiped on cancelled and sent rows');
  });

  test('deleted recipient → cancelled; admin operational email respects deactivation and the shipment_created preference', async () => {
    const gone = await insertCustomer({ isActive: true });
    const off = await insertAdmin({ assignedRoles: ['manager'] });
    const inactive = await insertAdmin({ assignedRoles: ['manager'], isActive: false });
    const params = { adminName: 'X', customerName: 'C', orderId: 'O', shipmentId: '00000000-0000-4000-8000-000000000000', shippingMode: 'air_freight' };
    await inTx(async (c) => {
      await enqueueEmail(c, { kind: 'customer.password_changed', to: gone.email, customerId: gone.id, params: { firstname: 'G' } });
      await enqueueEmail(c, { kind: 'admin.shipment_created', to: off.email, adminId: off.id, params });
      await enqueueEmail(c, { kind: 'admin.shipment_created', to: inactive.email, adminId: inactive.id, params });
      await enqueueEmail(c, { kind: 'admin.deactivated', to: inactive.email, adminId: inactive.id, params: { adminName: 'I' } });
    });
    await pool.query('DELETE FROM customers WHERE id = $1', [gone.id]);
    await pool.query(`UPDATE admins SET notification_prefs = '{"shipment_created": false}' WHERE id = $1`, [off.id]);
    await worker(new FakeProvider()).drain();
    assert.deepEqual(
      (await rowsOf()).map((r) => [r.kind, r.status, r.last_error]),
      [
        ['customer.password_changed', 'cancelled', 'customer deleted'],
        ['admin.shipment_created', 'cancelled', 'admin turned off new shipment emails'],
        ['admin.shipment_created', 'cancelled', 'admin is not active'],
        ['admin.deactivated', 'sent', null], // account notices still reach a deactivated admin
      ]
    );
  });

  const messageInput = (customer: { id: string; email: string }, n: number) => ({
    kind: 'customer.message' as const,
    to: customer.email,
    customerId: customer.id,
    groupKey: `msg:to_customer:${customer.id}`,
    delayMs: 120_000,
    params: { firstname: 'Ada', count: 1, hasPortal: true, messages: [{ sentAt: new Date(Date.UTC(2026, 9, 6, 14, n)).toISOString(), subject: `S${n}`, body: `body ${n}` }] },
  });

  test('grouping: 3 messages in the window → ONE email containing all 3 in order; once claimed, the next message starts a new row', async () => {
    const customer = await insertCustomer({ isActive: true });
    const send = (n: number) => inTx((c) => enqueueEmail(c, messageInput(customer, n)));
    const first = await send(1);
    const second = await send(2);
    const third = await send(3);
    assert.equal(first.grouped, false);
    assert.equal(second.grouped, true);
    assert.equal(third.id, first.id);
    let rows = await rowsOf();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].params.count, 3);
    assert.deepEqual(rows[0].params.messages.map((m: { body: string }) => m.body), ['body 1', 'body 2', 'body 3'], 'appended, oldest first');
    const window = new Date(rows[0].send_after).getTime() - Date.now();
    assert.ok(window > 100_000, 'send_after kept at the first message + 120s');

    const provider = new FakeProvider();
    await worker(provider).drain();
    assert.equal(provider.sent.length, 0, 'nothing sent inside the batch window');
    await makeDue();
    await worker(provider).drain();
    assert.equal(provider.sent.length, 1);
    const email = provider.sent[0];
    assert.equal(email.subject, '3 new messages from VHI');
    const positions = ['> body 1', '> body 2', '> body 3'].map((line) => email.text.indexOf(line));
    assert.ok(positions.every((p) => p >= 0), 'all three messages in the email');
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'oldest first');
    for (const n of [1, 2, 3]) assert.ok(email.text.includes(`Sent 6 Oct 2026, 15:0${n} WAT · Subject: S${n}`), `sent time of message ${n} in APP_TIMEZONE`);
    assert.ok(!('messages' in (await rowsOf())[0].params), 'messages wiped after sending');

    const after = await send(4);
    assert.notEqual(after.id, first.id, 'a new row after the grouped email was sent');
    rows = await rowsOf();
    assert.equal(rows.length, 2);
    assert.equal(rows[1].params.count, 1);
    assert.deepEqual(rows[1].params.messages.map((m: { body: string }) => m.body), ['body 4']);
  });

  test('grouping keeps only the newest 10 stored messages but counts all of them', async () => {
    const customer = await insertCustomer({ isActive: true });
    for (let n = 1; n <= 14; n++) await inTx((c) => enqueueEmail(c, messageInput(customer, n)));
    const [row] = await rowsOf();
    assert.equal(row.params.count, 14);
    assert.deepEqual(row.params.messages.map((m: { body: string }) => m.body), Array.from({ length: 10 }, (_, i) => `body ${i + 5}`));
    await makeDue();
    const provider = new FakeProvider();
    await worker(provider).drain();
    assert.ok(provider.sent[0].text.includes('+4 earlier messages. Reply to this email or contact support to see them.'));
  });

  test('two messages arriving at the same moment are both appended (no lost update)', async () => {
    const customer = await insertCustomer({ isActive: true });
    await inTx((c) => enqueueEmail(c, messageInput(customer, 1)));
    // Two transactions enqueue concurrently; the second blocks on the row lock and must still append, not overwrite.
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await enqueueEmail(a, messageInput(customer, 2));
      const pending = enqueueEmail(b, messageInput(customer, 3)); // waits for a's row lock
      await new Promise((r) => setTimeout(r, 150));
      await a.query('COMMIT');
      await pending;
      await b.query('COMMIT');
    } finally {
      a.release();
      b.release();
    }
    // And a burst of parallel transactions.
    await Promise.all([4, 5, 6, 7].map((n) => inTx((c) => enqueueEmail(c, messageInput(customer, n)))));
    const rows = await rowsOf();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].params.count, 7);
    const bodies = rows[0].params.messages.map((m: { body: string }) => m.body);
    assert.deepEqual([...bodies].sort(), ['body 1', 'body 2', 'body 3', 'body 4', 'body 5', 'body 6', 'body 7']);
    assert.deepEqual(bodies.slice(0, 3), ['body 1', 'body 2', 'body 3'], 'commit order kept');
  });

  test('message texts are wiped after sent, failed and cancelled', async () => {
    const sentTo = await insertCustomer({ isActive: true });
    const failTo = await insertCustomer({ isActive: true });
    const cancelTo = await insertCustomer({ isActive: true });
    for (const c of [sentTo, failTo, cancelTo]) await inTx((tx) => enqueueEmail(tx, { ...messageInput(c, 1), delayMs: 0 }));
    await pool.query('DELETE FROM customers WHERE id = $1', [cancelTo.id]);
    const provider = new FakeProvider();
    provider.script.push(() => {}); // first claimed row: sent
    provider.script.push(() => {
      throw new EmailSendError('permanent', 'rejected');
    });
    await worker(provider, { concurrency: 1 }).drain();
    const rows = await rowsOf();
    assert.deepEqual(rows.map((r) => r.status), ['sent', 'failed', 'cancelled']);
    for (const r of rows) assert.ok(!('messages' in r.params) && !('body' in r.params), `${r.status}: message text wiped`);
  });

  test('preference emails carry RFC 8058 List-Unsubscribe headers; service emails do not', async () => {
    const customer = await insertCustomer({ isActive: true });
    await inTx(async (c) => {
      await enqueueEmail(c, { kind: 'customer.tracking_assigned', to: customer.email, customerId: customer.id, params: { firstname: 'A', orderId: 'O1', awbNumber: '176-1', bolNumber: null } });
      await enqueueEmail(c, { kind: 'customer.password_changed', to: customer.email, customerId: customer.id, params: { firstname: 'A' } });
    });
    const provider = new FakeProvider();
    await worker(provider, { concurrency: 1 }).drain();
    const [pref, service] = provider.sent;
    assert.match(pref.headers!['List-Unsubscribe'], /^<https:\/\/api\.test\/api\/email\/unsubscribe\?token=[^>]+>$/);
    assert.equal(pref.headers!['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.deepEqual(service.headers, {});
    assert.equal(pref.replyTo, 'support@test.local');
    assert.equal(pref.from, 'VHI <noreply@test.local>');
  });
});

describe('email configuration and providers', () => {
  const prodEnv = {
    NODE_ENV: 'production',
    RESEND_API_KEY: 're_test',
    EMAIL_LINK_SECRET: 's'.repeat(40),
    API_PUBLIC_URL: 'https://api.example.com',
    CLIENT_FRONTEND_URL: 'https://client.example.com',
    ADMIN_FRONTEND_URL: 'https://admin.example.com',
  };

  test('development defaults to the console provider and needs no secrets', () => {
    const cfg = emailConfigFromEnv({ NODE_ENV: 'development' });
    assert.equal(cfg.provider, 'console');
    assert.ok(createProvider(cfg) instanceof ConsoleProvider);
    assert.equal(cfg.from, LEGACY_FROM);
    assert.ok(cfg.linkSecret.length >= 32);
  });

  test('production: resend by default; every missing requirement is listed; EMAIL_FROM unset is only a warning', () => {
    const ok = emailConfigFromEnv(prodEnv);
    assert.equal(ok.provider, 'resend');
    assert.ok(ok.warnings.some((w) => w.includes('EMAIL_FROM is not set')));
    assert.throws(
      () => emailConfigFromEnv({ NODE_ENV: 'production' }),
      (err: unknown) =>
        err instanceof EmailConfigError &&
        ['RESEND_API_KEY', 'EMAIL_LINK_SECRET', 'API_PUBLIC_URL', 'CLIENT_FRONTEND_URL', 'ADMIN_FRONTEND_URL'].every((n) => err.message.includes(n))
    );
    assert.throws(() => emailConfigFromEnv({ ...prodEnv, EMAIL_LINK_SECRET: 'short' }), /at least 32/);
    assert.throws(() => emailConfigFromEnv({ ...prodEnv, API_PUBLIC_URL: 'javascript:alert(1)' }), /API_PUBLIC_URL/);
    assert.equal(emailConfigFromEnv({ ...prodEnv, RESEND_API_KEY: '', EMAIL_PROVIDER: 'console' }).provider, 'console');
  });

  test('console provider logs recipient, subject and the text part only', async () => {
    const lines: string[] = [];
    await new ConsoleProvider((l) => lines.push(l)).send({ to: 'a@b.c', from: 'f', subject: 'Subj', html: '<p>HTML ONLY</p>', text: 'TEXT PART', idempotencyKey: 'k' });
    assert.match(lines[0], /to: a@b\.c/);
    assert.match(lines[0], /subject: Subj/);
    assert.match(lines[0], /TEXT PART/);
    assert.ok(!lines[0].includes('HTML ONLY'));
  });

  test('Resend errors are classified (retryable / permanent / rate_limited with Retry-After)', () => {
    const c = (name: string, statusCode: number | null, headers: Record<string, string> | null = null) =>
      classifyResendError({ name, statusCode, message: 'm' }, headers);
    assert.equal(c('application_error', null).kind, 'retryable');
    assert.equal(c('internal_server_error', 500).kind, 'retryable');
    assert.equal(c('concurrent_idempotent_requests', 409).kind, 'retryable');
    assert.equal(c('invalid_api_key', 403).kind, 'retryable');
    assert.equal(c('validation_error', 422).kind, 'permanent');
    assert.equal(c('invalid_from_address', 422).kind, 'permanent');
    assert.equal(c('invalid_idempotent_request', 409).kind, 'permanent');
    const limited = c('rate_limit_exceeded', 429, { 'retry-after': '7' });
    assert.equal(limited.kind, 'rate_limited');
    assert.equal(limited.retryAfterMs, 7000);
    assert.equal(c('daily_quota_exceeded', 429).retryAfterMs, 3_600_000);
  });

  test('importing the email modules without RESEND_API_KEY never throws; the production server refuses to START with a clear message', () => {
    const backend = path.join(__dirname, '..');
    const tsxCli = path.join(backend, 'node_modules/tsx/dist/cli.mjs');
    const env = { ...process.env, NODE_ENV: 'production', RESEND_API_KEY: '', EMAIL_LINK_SECRET: '', API_PUBLIC_URL: '', PORT: '0' } as NodeJS.ProcessEnv;
    delete env.VHI_TEST_SETUP;
    // Run from test/ (no .env there), so the real apps/backend/.env is never loaded into the child.
    const imp = spawnSync(
      process.execPath,
      [tsxCli, '-e', "require('../src/modules/email'); require('../src/modules/email/resendProvider'); require('../src/modules/email/worker'); console.log('imported')"],
      { cwd: __dirname, env, encoding: 'utf8', timeout: 60_000 }
    );
    assert.equal(imp.status, 0, imp.stderr);
    assert.match(imp.stdout, /imported/);

    const start = spawnSync(process.execPath, [tsxCli, path.join(backend, 'src/index.ts')], { cwd: __dirname, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(start.status, 1);
    assert.match(start.stderr, /\[email\] Email configuration is invalid/);
    assert.match(start.stderr, /RESEND_API_KEY is required/);
    assert.match(start.stderr, /EMAIL_LINK_SECRET is required in production/);
    assert.ok(!/VHI CRM Server running/.test(start.stdout), 'never started listening');
  });
});
