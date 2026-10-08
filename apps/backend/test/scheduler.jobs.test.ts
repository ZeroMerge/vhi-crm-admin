import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { insertAdmin, insertCustomer, insertInvoice, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import type { Job } from '../src/modules/scheduler/scheduler';
import { schedulerConfigFromEnv, SchedulerConfig } from '../src/modules/scheduler/config';
import { stuckShipmentsJob } from '../src/modules/scheduler/jobs/stuckShipments';
import { overdueInvoicesJob } from '../src/modules/scheduler/jobs/overdueInvoices';
import { registrationDigestJob } from '../src/modules/scheduler/jobs/registrationDigest';
import { cleanupJob, CLEANUP_BATCH } from '../src/modules/scheduler/jobs/cleanup';
import { setShipmentStatus } from '../src/modules/shipments/statusUpdate';
import { EmailWorker } from '../src/modules/email/worker';
import type { EmailProvider, OutgoingEmail } from '../src/modules/email/provider';
import { renderTemplate, templateContext } from '../src/modules/email/templates';
import clientAuthRoutes from '../src/modules/client/client.auth.routes';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const CONFIG = schedulerConfigFromEnv({});
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BASES = { client: 'https://client.test', admin: 'https://admin.test', api: 'https://api.test' };

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}
/** One job run exactly as the scheduler does it: one transaction, the run's start time as `now`. */
const runAt = (job: Job, now: Date, config: SchedulerConfig = CONFIG) => inTx((client) => job.run({ client, pool, now, config, log: quiet }));

const notificationsOf = async (type: string) =>
  (await pool.query('SELECT admin_id, title, body, entity_type, entity_id, data FROM notifications WHERE type = $1 ORDER BY id', [type])).rows;
const digestsOf = async (kind: string) =>
  (await pool.query('SELECT admin_id, to_address, group_key, params, status, last_error FROM email_deliveries WHERE kind = $1 ORDER BY id', [kind])).rows;

class FakeProvider implements EmailProvider {
  readonly name = 'fake';
  sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail) {
    this.sent.push(email);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}

describe('Phase 4 jobs', dbTest, () => {
  let app: TestApp;
  before(async () => {
    await resetDatabase();
    app = await startApp([['/api/client/auth', clientAuthRoutes]]);
  });
  beforeEach(async () => {
    await truncateAll();
    clearAdminAccountCache();
  });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  describe('stuck-shipments', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    const stuckAt = async (status: string, hoursAgo: number, customerId: string) => {
      const s = await insertShipment(customerId, { status });
      await pool.query('UPDATE shipments SET status_changed_at = $2 WHERE id = $1', [s.id, new Date(now.getTime() - hoursAgo * HOUR)]);
      return s;
    };

    test('per-status thresholds, operations roles only, once per stuck period, then a reminder a week later', async () => {
      const ops = await insertAdmin({ assignedRoles: ['logistics_officer'] });
      const boss = await insertAdmin({ assignedRoles: ['super_admin'] });
      await insertAdmin({ assignedRoles: ['finance_officer'] });
      const c = await insertCustomer();
      const pendingStuck = await stuckAt('pending', 49, c.id);
      await stuckAt('pending', 47, c.id);
      const processing = await stuckAt('processing', 73, c.id);
      await stuckAt('in_transit', 13 * 24, c.id);
      const clearance = await stuckAt('clearance', 8 * 24, c.id);
      await stuckAt('draft', 30 * 24, c.id);
      await stuckAt('delivered', 30 * 24, c.id);
      await stuckAt('cancelled', 30 * 24, c.id);

      assert.match(String(await runAt(stuckShipmentsJob, now)), /^3 shipment\(s\) alerted, 6 notification\(s\)/);
      let rows = await notificationsOf('shipment.stuck');
      assert.equal(rows.length, 6);
      assert.deepEqual(new Set(rows.map((r) => r.admin_id)), new Set([ops.id, boss.id]), 'operations roles only (not finance)');
      assert.deepEqual(new Set(rows.map((r) => r.entity_id)), new Set([pendingStuck.id, processing.id, clearance.id]));
      const pendingRow = rows.find((r) => r.entity_id === pendingStuck.id && r.admin_id === ops.id)!;
      assert.equal(pendingRow.title, `Shipment ${pendingStuck.order_id} stuck in Pending for 2 days`);
      assert.equal(pendingRow.body, 'No status change since 5 Oct 2026. Threshold: 2 days.');
      assert.equal(pendingRow.entity_type, 'shipment');

      // Hourly re-runs add nothing.
      await runAt(stuckShipmentsJob, new Date(now.getTime() + HOUR / 2));
      assert.equal((await notificationsOf('shipment.stuck')).length, 6);
      // Within the week, nothing more for this shipment (others may cross their own thresholds meanwhile).
      const forPending = async () => (await notificationsOf('shipment.stuck')).filter((r) => r.entity_id === pendingStuck.id);
      await runAt(stuckShipmentsJob, new Date(now.getTime() + 6 * DAY));
      assert.equal((await forPending()).length, 2);

      // A week after it crossed the threshold: one reminder per admin.
      await runAt(stuckShipmentsJob, new Date(now.getTime() + 7 * DAY));
      rows = await forPending();
      assert.equal(rows.length, 4);
      const reminder = rows[2];
      assert.equal(reminder.title, `Still stuck: Shipment ${pendingStuck.order_id} stuck in Pending for 9 days`);
      assert.equal(reminder.data.reminder, 1);
    });

    test('reminder cap: after STUCK_MAX_REMINDERS nothing more for that period; downtime sends only the current reminder', async () => {
      await insertAdmin({ assignedRoles: ['logistics_officer'] });
      const c = await insertCustomer();
      // Threshold crossed 4 weeks + 1h ago → n = 4 (the 4th reminder, still within the cap of 4).
      const atCap = await stuckAt('pending', 48 + 4 * 7 * 24 + 1, c.id);
      // 5 weeks → n = 5: past the cap.
      await stuckAt('pending', 48 + 5 * 7 * 24 + 1, c.id);
      await runAt(stuckShipmentsJob, now);
      const rows = await notificationsOf('shipment.stuck');
      assert.equal(rows.length, 1, 'only the shipment within the cap; missed earlier reminders are not replayed');
      assert.equal(rows[0].entity_id, atCap.id);
      assert.equal(rows[0].data.reminder, 4);

      await runAt(stuckShipmentsJob, now, { ...CONFIG, stuckMaxReminders: 0 });
      assert.equal((await notificationsOf('shipment.stuck')).length, 1);
    });

    test('a transition (incl. a correction) starts a new stuck period', async () => {
      await insertAdmin({ assignedRoles: ['logistics_officer'] });
      const c = await insertCustomer();
      const s = await stuckAt('processing', 80, c.id);
      await runAt(stuckShipmentsJob, now);
      assert.equal((await notificationsOf('shipment.stuck')).length, 1);

      // Correction back to pending at `now - 1h` (the helper stamps NOW(); move it to the test clock).
      await inTx((client) => setShipmentStatus(client, s.id, 'pending'));
      await pool.query('UPDATE shipments SET status_changed_at = $2 WHERE id = $1', [s.id, new Date(now.getTime() - HOUR)]);
      await runAt(stuckShipmentsJob, new Date(now.getTime() + 40 * HOUR));
      assert.equal((await notificationsOf('shipment.stuck')).length, 1, 'not stuck yet in the new status');
      await runAt(stuckShipmentsJob, new Date(now.getTime() + 48 * HOUR));
      const rows = await notificationsOf('shipment.stuck');
      assert.equal(rows.length, 2, 'new period → a new first alert');
      assert.match(rows[1].title, /^Shipment .* stuck in Pending for 2 days$/);
    });
  });

  describe('overdue-invoices', () => {
    const now = new Date('2026-10-07T06:00:00Z'); // 07:00 WAT on 7 Oct
    const invoice = async (customerId: string | null, due: string, status = 'sent', amount = '1500.00') => {
      const c = customerId ?? (await insertCustomer()).id;
      const i = await insertInvoice(c, { status, amount });
      await pool.query('UPDATE invoices SET due_date = $2, customer_id = $3 WHERE id = $1', [i.id, due, customerId]);
      return i;
    };

    test('alerts once, digest of newly overdue to finance admins with the preference on; drafts/paid/out-of-cap/no-customer excluded', async () => {
      const finance = await insertAdmin({ assignedRoles: ['finance_officer'] });
      const manager = await insertAdmin({ assignedRoles: ['manager'] });
      await pool.query(`UPDATE admins SET notification_prefs = '{"overdue_alert": false}' WHERE id = $1`, [manager.id]);
      await insertAdmin({ assignedRoles: ['logistics_officer'] });
      const c = await insertCustomer();
      const newly = await invoice(c.id, '2026-10-06', 'sent', '1250000.5');
      const older = await invoice(c.id, '2026-09-29', 'part_paid'); // 8 days → reminder 1
      await pool.query(
        `INSERT INTO payments (invoice_id, customer_id, amount, payment_method, payment_status) VALUES ($1, $2, '500.00', 'manual', 'success')`,
        [older.id, c.id]
      );
      await invoice(c.id, '2026-10-07'); // due today: not overdue
      await invoice(c.id, '2026-10-01', 'draft');
      await invoice(c.id, '2026-10-01', 'paid');
      await invoice(c.id, '2026-07-01', 'pending'); // 98 days → n = 13 > 8
      await invoice(null, '2026-10-01'); // no customer

      await runAt(overdueInvoicesJob, now);
      const rows = await notificationsOf('invoice.overdue');
      assert.equal(rows.length, 4, '2 invoices × finance + manager (in-app has no preference)');
      assert.deepEqual(new Set(rows.map((r) => r.admin_id)), new Set([finance.id, manager.id]));
      const first = rows.find((r) => r.entity_id === newly.id)!;
      assert.equal(first.entity_type, 'invoice');
      assert.equal(first.title, `Invoice ${newly.invoice_number} is overdue`);
      assert.equal(first.body, 'Test Customer: 1,250,000.50 NGN, due 6 Oct 2026.');
      const reminder = rows.find((r) => r.entity_id === older.id)!;
      assert.equal(reminder.title, `Invoice ${older.invoice_number} is still overdue (8 days)`);
      assert.equal(reminder.body, 'Test Customer: 1,000.00 NGN, due 29 Sep 2026.', 'outstanding balance, not the invoice total');

      const digests = await digestsOf('admin.overdue_digest');
      assert.equal(digests.length, 1, 'finance only: manager turned it off, logistics has no invoices module');
      assert.equal(digests[0].admin_id, finance.id);
      assert.equal(digests[0].group_key, `overdue-digest:2026-10-07:${finance.id}`);
      assert.equal(digests[0].params.total, 1);
      assert.deepEqual(digests[0].params.invoices.map((i: { number: string }) => i.number), [newly.invoice_number], 'newly overdue only, not reminders');
      assert.equal(digests[0].params.date, '7 Oct 2026');
    });

    test('running the job twice for the same date queues one digest per admin (also when alerts are re-created)', async () => {
      await insertAdmin({ assignedRoles: ['finance_officer'] });
      await insertAdmin({ assignedRoles: ['super_admin'] });
      const c = await insertCustomer();
      await invoice(c.id, '2026-10-06');
      await runAt(overdueInvoicesJob, now);
      await runAt(overdueInvoicesJob, new Date(now.getTime() + 2 * HOUR));
      assert.equal((await digestsOf('admin.overdue_digest')).length, 2);
      // Even if the "newly overdue" alerts were somehow created again, admins with a digest for this date are skipped.
      await pool.query(`DELETE FROM notifications`);
      await runAt(overdueInvoicesJob, now);
      assert.equal((await notificationsOf('invoice.overdue')).length, 2);
      assert.equal((await digestsOf('admin.overdue_digest')).length, 2);
      // The next day is a new date (but nothing is newly overdue then).
      await runAt(overdueInvoicesJob, new Date(now.getTime() + DAY));
      assert.equal((await digestsOf('admin.overdue_digest')).length, 2);
    });

    test('"today" is the APP_TIMEZONE date: 23:30 UTC on the due date is already the next day in Lagos', async () => {
      await insertAdmin({ assignedRoles: ['finance_officer'] });
      const c = await insertCustomer();
      await invoice(c.id, '2026-10-06');
      await runAt(overdueInvoicesJob, new Date('2026-10-06T22:30:00Z')); // 23:30 WAT on 6 Oct
      assert.equal((await notificationsOf('invoice.overdue')).length, 0);
      await runAt(overdueInvoicesJob, new Date('2026-10-06T23:30:00Z')); // 00:30 WAT on 7 Oct
      assert.equal((await notificationsOf('invoice.overdue')).length, 1);
      assert.equal((await digestsOf('admin.overdue_digest'))[0].group_key.split(':')[1], '2026-10-07');
    });

    test('the worker re-checks the preference at send time', async () => {
      const finance = await insertAdmin({ assignedRoles: ['finance_officer'] });
      const c = await insertCustomer();
      await invoice(c.id, '2026-10-06');
      await runAt(overdueInvoicesJob, now);
      await pool.query(`UPDATE admins SET notification_prefs = '{"overdue_alert": false}' WHERE id = $1`, [finance.id]);
      const provider = new FakeProvider();
      await new EmailWorker({
        pool,
        provider,
        log: quiet,
        config: { from: 'VHI <noreply@test.local>', replyTo: null, linkSecret: 'x'.repeat(64), bases: BASES, concurrency: 2 },
      }).drain();
      assert.equal(provider.sent.length, 0);
      const [row] = await digestsOf('admin.overdue_digest');
      assert.deepEqual([row.status, row.last_error], ['cancelled', 'admin turned off overdue invoice emails']);
    });
  });

  describe('registration-digest and customer.registered', () => {
    const now = new Date('2026-10-07T07:00:00Z'); // 08:00 WAT on 7 Oct → covers 6 Oct 00:00–24:00 WAT
    const verifiedAt = async (iso: string | null, name: string) => {
      const c = await insertCustomer();
      await pool.query(`UPDATE customers SET verified_at = $2, firstname = $3, industry = 'oil_gas' WHERE id = $1`, [c.id, iso, name]);
      return c;
    };

    test('one email per growth admin with the preference on, listing yesterday (WAT) in order; twice → still one', async () => {
      const crm = await insertAdmin({ assignedRoles: ['crm_officer'] });
      const manager = await insertAdmin({ assignedRoles: ['manager'] });
      await pool.query(`UPDATE admins SET notification_prefs = '{"registration": false}' WHERE id = $1`, [manager.id]);
      await insertAdmin({ assignedRoles: ['finance_officer'] });
      await verifiedAt('2026-10-05T22:59:00Z', 'TooEarly'); // 23:59 WAT on 5 Oct
      const a = await verifiedAt('2026-10-05T23:15:00Z', 'Early'); // 00:15 WAT on 6 Oct
      const b = await verifiedAt('2026-10-06T12:00:00Z', 'Noon');
      await verifiedAt('2026-10-06T23:00:00Z', 'TooLate'); // 00:00 WAT on 7 Oct
      await verifiedAt(null, 'Unverified');

      assert.equal(await runAt(registrationDigestJob, now), '2 registration(s), 1 digest email(s)');
      await runAt(registrationDigestJob, new Date(now.getTime() + 3 * HOUR));
      const digests = await digestsOf('admin.registration_digest');
      assert.equal(digests.length, 1);
      assert.equal(digests[0].admin_id, crm.id);
      assert.equal(digests[0].group_key, `reg-digest:2026-10-07:${crm.id}`);
      assert.equal(digests[0].params.date, '6 Oct 2026');
      assert.deepEqual(digests[0].params.customers.map((x: { customerId: string }) => x.customerId), [a.id, b.id]);

      const email = renderTemplate('admin.registration_digest', digests[0].params, templateContext({ bases: BASES, supportReplyTo: false }));
      assert.equal(email.subject, '2 new customers registered yesterday');
      assert.ok(email.text.includes(`${a.email} · Oil gas · 00:15 WAT`), email.text);
      assert.ok(email.text.includes(`${b.email} · Oil gas · 13:00 WAT`), email.text);
    });

    test('no registrations → no email', async () => {
      await insertAdmin({ assignedRoles: ['crm_officer'] });
      await verifiedAt('2026-10-04T12:00:00Z', 'Old');
      assert.equal(await runAt(registrationDigestJob, now), 'no registrations yesterday');
      assert.equal((await digestsOf('admin.registration_digest')).length, 0);
    });

    test('in-app: at verification only in production (not at signup), at signup without verification (D7), once per customer', async () => {
      const crm = await insertAdmin({ assignedRoles: ['crm_officer'] });
      await insertAdmin({ assignedRoles: ['logistics_officer'] });
      const body = { firstname: 'Ngozi', lastname: 'Eze', email: 'ngozi@test.local', password: 'Secret-Pass-1' };
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        assert.equal((await request(app, 'POST', '/api/client/auth/register', { body })).status, 201);
      } finally {
        process.env.NODE_ENV = prev;
      }
      assert.equal((await notificationsOf('customer.registered')).length, 0, 'not at signup in production');

      const token = (await pool.query('SELECT token FROM email_verification_tokens')).rows[0].token;
      assert.equal((await request(app, 'GET', `/api/client/auth/verify-email?token=${token}`)).status, 200);
      assert.equal((await request(app, 'GET', `/api/client/auth/verify-email?token=${token}`)).status, 404, 'single use');
      let rows = await notificationsOf('customer.registered');
      assert.equal(rows.length, 1, 'crm_officer only (logistics has no customers module)');
      assert.equal(rows[0].admin_id, crm.id);
      assert.equal(rows[0].entity_type, 'customer');
      assert.equal(rows[0].title, 'New customer Ngozi Eze');
      assert.equal(rows[0].body, 'ngozi@test.local verified their account.');

      assert.equal((await request(app, 'POST', '/api/client/auth/register', { body: { ...body, email: 'dev@test.local' } })).status, 201);
      rows = await notificationsOf('customer.registered');
      assert.equal(rows.length, 2, 'non-production signup counts as verified');
      assert.equal(rows[1].body, 'dev@test.local verified their account.');
    });

    test('an expired verification link changes nothing and notifies nobody', async () => {
      await insertAdmin({ assignedRoles: ['crm_officer'] });
      const c = await insertCustomer({ isActive: false });
      await pool.query(`INSERT INTO email_verification_tokens (customer_id, token, expires_at) VALUES ($1, 'expired-token', NOW() - interval '1 minute')`, [c.id]);
      assert.equal((await request(app, 'GET', '/api/client/auth/verify-email?token=expired-token')).status, 410);
      const row = (await pool.query('SELECT is_active, verified_at FROM customers WHERE id = $1', [c.id])).rows[0];
      assert.deepEqual([row.is_active, row.verified_at], [false, null]);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM email_verification_tokens')).rows[0].n, 0);
      assert.equal((await notificationsOf('customer.registered')).length, 0);
    });
  });

  describe('cleanup', () => {
    test('retention boundaries, read vs unread, more than one batch, queued emails kept', async () => {
      const now = new Date('2026-10-07T02:30:00Z');
      const admin = await insertAdmin();
      const ago = (days: number) => new Date(now.getTime() - days * DAY);
      const notifications = (count: number, createdAt: Date, read: boolean, tag: string) =>
        pool.query(
          `INSERT INTO notifications (admin_id, module, type, entity_type, entity_id, title, actor_type, dedupe_key, read_at, created_at)
           SELECT $1, 'shipments', 'test', 'shipment', gen_random_uuid(), $5, 'system', $5 || g, CASE WHEN $3 THEN $2::timestamptz END, $2
             FROM generate_series(1, $4) g`,
          [admin.id, createdAt, read, count, tag]
        );
      await notifications(CLEANUP_BATCH + 100, ago(100), true, 'read-old-');
      await notifications(1, ago(89), true, 'read-keep-');
      await notifications(1, ago(179), false, 'unread-keep-');
      await notifications(2, ago(181), false, 'unread-old-');
      const email = (status: string, createdAt: Date) =>
        pool.query(`INSERT INTO email_deliveries (kind, to_address, status, created_at) VALUES ('admin.password_changed', 'x@test.local', $1, $2)`, [status, createdAt]);
      await email('sent', ago(91));
      await email('failed', ago(91));
      await email('cancelled', ago(91));
      await email('sent', ago(89));
      await email('queued', ago(200));
      await email('sending', ago(200));
      await pool.query(`INSERT INTO processed_webhooks (id, provider, received_at) VALUES ('old', 'resend', $1), ('new', 'resend', $2)`, [ago(31), ago(29)]);

      const summary = await runAt(cleanupJob, now);
      assert.equal(summary, `deleted ${CLEANUP_BATCH + 100} read + 2 unread notification(s), 3 email row(s), 1 webhook id(s)`);
      const left = (await pool.query(`SELECT title FROM notifications ORDER BY title`)).rows.map((r) => r.title);
      assert.deepEqual(left, ['read-keep-', 'unread-keep-']);
      const emails = (await pool.query(`SELECT status FROM email_deliveries ORDER BY status`)).rows.map((r) => r.status);
      assert.deepEqual(emails, ['queued', 'sending', 'sent']);
      assert.deepEqual((await pool.query('SELECT id FROM processed_webhooks')).rows.map((r) => r.id), ['new']);
    });
  });
});
