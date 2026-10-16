import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { Router } from 'express';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, customerToken, insertAdmin, insertCustomer } from './helpers/fixtures';
import { eventsOf, openStream, sleep, SseConnection } from './helpers/sse';
import pool from '../src/config/db';
import { adminMiddleware } from '../src/middleware/adminMiddleware';
import { customerMiddleware } from '../src/middleware/customerMiddleware';
import { clearAdminAccountCache, requireActiveAdmin } from '../src/middleware/permissions';
import { PgNotifyBus } from '../src/modules/notifications/realtime/pgNotifyBus';
import { SseHub, SseHubConfig } from '../src/modules/notifications/realtime/sseHub';
import { adminVisibility, createStreamHandler, fetchPushRows } from '../src/modules/notifications/realtime';
import communicationsRoutes from '../src/modules/communications/communications.routes';
import clientCommunicationsRoutes from '../src/modules/client/client.communications.routes';

const quiet = { warn: () => {}, error: () => {}, info: () => {} };
const CONFIG: SseHubConfig = { heartbeatMs: 5_000, maxPerUser: 5, maxConnections: 50, connectsPerMinute: 100, drainTimeoutMs: 500, reauthLeadMs: 1000 };

describe('communications over the notification stream (Phase 5)', dbTest, () => {
  let app: TestApp;
  let bus: PgNotifyBus;
  let hub: SseHub;
  const open: SseConnection[] = [];

  before(async () => {
    await resetDatabase();
    bus = new PgNotifyBus({ connectionString: process.env.TEST_DATABASE_URL!, minBackoffMs: 50, maxBackoffMs: 200, log: quiet });
    await bus.start();
    hub = new SseHub(CONFIG, { bus, fetchRows: fetchPushRows, adminVisibility, log: quiet });
    const admin = Router();
    admin.use(adminMiddleware, requireActiveAdmin);
    admin.get('/stream', createStreamHandler(hub, 'admin'));
    const client = Router();
    client.use(customerMiddleware);
    client.get('/stream', createStreamHandler(hub, 'customer'));
    app = await startApp([
      ['/t/admin', admin],
      ['/t/client', client],
      ['/api/admin/communications', communicationsRoutes],
      ['/api/client/communications', clientCommunicationsRoutes],
    ]);
  });
  beforeEach(async () => {
    while (open.length) open.pop()!.close();
    const end = Date.now() + 3000;
    while (hub.stats().connections > 0 && Date.now() < end) await sleep(20);
    await truncateAll();
    clearAdminAccountCache();
  });
  after(async () => {
    while (open.length) open.pop()!.close();
    hub.shutdown();
    await bus.stop();
    await app?.close();
    await pool.end();
  });

  async function connect(kind: 'admin' | 'client', token: string) {
    const conn = await openStream(`${app.url}/t/${kind}/stream`, token);
    open.push(conn);
    assert.equal(conn.status, 200);
    await conn.waitFor((m) => m.some((x) => x.event === 'ready'));
    return conn;
  }
  const admin = async (role: string) => {
    const a = await insertAdmin({ assignedRoles: [role] });
    return { ...a, token: adminToken({ ...a, activeRole: role }) };
  };
  const customer = async () => {
    const c = await insertCustomer();
    return { ...c, token: customerToken(c) };
  };
  const customerSends = (c: { token: string }, body: string) =>
    request(app, 'POST', '/api/client/communications/send', { token: c.token, body: { subject: `Subj ${body}`, body } });
  const adminSends = (a: { token: string }, customerId: string, body: string) =>
    request(app, 'POST', '/api/admin/communications/send', { token: a.token, body: { customerId, subject: `Subj ${body}`, body } });
  const flags = async (ids: string[]) =>
    Object.fromEntries((await pool.query('SELECT id, read_by_admin, read_by_customer FROM communications WHERE id = ANY($1::uuid[])', [ids])).rows.map((r) => [r.id, r]));

  test('customer send: the customer\'s tabs and every communications admin get message_created (ids only); finance gets nothing', async () => {
    const c = await customer();
    const admins = await Promise.all(['super_admin', 'manager', 'logistics_officer', 'crm_officer', 'support_staff', 'finance_officer'].map(admin));
    const tabs = [await connect('client', c.token), await connect('client', c.token)];
    const streams = await Promise.all(admins.map((a) => connect('admin', a.token)));
    const secret = `secret-text-${crypto.randomUUID()}`;
    const sent = await customerSends(c, secret);
    assert.equal(sent.status, 201);
    const expected = { customerId: c.id, messageId: sent.body.data.id, senderType: 'customer' };

    for (const s of [...tabs, ...streams.slice(0, 5)]) {
      await s.waitFor((m) => m.some((x) => x.event === 'message_created'));
      assert.deepEqual(eventsOf(s, 'message_created'), [expected]);
    }
    await sleep(300);
    assert.deepEqual(eventsOf(streams[5], 'message_created'), [], 'finance_officer has no communications module');
    for (const s of [...tabs, ...streams]) {
      for (const m of s.messages.filter((x) => x.event === 'message_created')) {
        assert.ok(!m.data.includes(secret) && !m.data.includes('Subj'), 'message_created never carries message text or subject');
      }
    }
    // The customer's own streams carry no text at all (their own message makes no bell notification for them). Admin streams
    // also get the existing bell `notification`, whose body is a message excerpt by design (Phase 1).
    for (const s of tabs) assert.ok(!s.raw.includes(secret));
  });

  test('admin send: the customer and the other communications admins get it; a role removed after connecting gets nothing', async () => {
    const c = await customer();
    const sender = await admin('manager');
    const other = await admin('crm_officer');
    const demoted = await admin('logistics_officer');
    const cs = await connect('client', c.token);
    const os = await connect('admin', other.token);
    const ds = await connect('admin', demoted.token);
    await pool.query(`UPDATE admins SET assigned_roles = ARRAY['finance_officer'] WHERE id = $1`, [demoted.id]);
    clearAdminAccountCache();

    const sent = await adminSends(sender, c.id, 'hello from VHI');
    assert.equal(sent.status, 201);
    const expected = { customerId: c.id, messageId: sent.body.data.id, senderType: 'admin' };
    await cs.waitFor((m) => m.some((x) => x.event === 'message_created'));
    await os.waitFor((m) => m.some((x) => x.event === 'message_created'));
    assert.deepEqual(eventsOf(cs, 'message_created'), [expected]);
    assert.deepEqual(eventsOf(os, 'message_created'), [expected]);
    await ds.waitForEnd(3000);
    assert.deepEqual(eventsOf(ds, 'message_created'), [], 'push-time check: no longer holds the module');
    assert.ok(ds.messages.some((m) => m.event === 'reauth'), 'its token role was removed: reauth');
  });

  test('a send that fails at COMMIT pushes nothing', async () => {
    const c = await customer();
    const a = await admin('manager');
    const as = await connect('admin', a.token);
    await pool.query(`CREATE FUNCTION fail_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'commit refused'; END $$`);
    await pool.query(`CREATE CONSTRAINT TRIGGER fail_at_commit AFTER INSERT ON communications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_at_commit()`);
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal((await customerSends(c, 'never committed')).status, 500);
    } finally {
      console.error = original;
      await pool.query('DROP TRIGGER fail_at_commit ON communications');
      await pool.query('DROP FUNCTION fail_at_commit()');
    }
    await sleep(400);
    assert.deepEqual(eventsOf(as, 'message_created'), []);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM communications')).rows[0].n, 0);
  });

  test('?ids=: scoped to the thread (foreign ids silently omitted), deduplicated, UUIDs only, at most 50; never marks', async () => {
    const a = await admin('manager');
    const mine = await customer();
    const other = await customer();
    const m1 = (await adminSends(a, mine.id, 'to mine')).body.data.id;
    const m2 = (await customerSends(mine, 'from mine')).body.data.id;
    const foreign = (await adminSends(a, other.id, 'to other')).body.data.id;
    const foreignOwn = (await customerSends(other, 'from other')).body.data.id;

    const cget = (q: string) => request(app, 'GET', `/api/client/communications${q}`, { token: mine.token });
    let res = await cget(`?ids=${m1},${foreign},${foreignOwn},${m1.toUpperCase()},${m2}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((r: { id: string }) => r.id).sort(), [m1, m2].sort(), 'a customer never gets another customer\'s messages');
    res = await cget(`?ids=${foreign},${foreignOwn}`);
    assert.deepEqual([res.status, res.body.data], [200, []], 'same answer as for ids that do not exist');
    assert.equal((await cget('?ids=not-a-uuid')).status, 400);
    assert.equal((await cget(`?ids=${Array.from({ length: 51 }, () => crypto.randomUUID()).join(',')}`)).status, 400);
    assert.equal((await cget('?ids=')).status, 400);
    assert.equal((await cget(`?ids=${Array.from({ length: 50 }, () => m1).join(',')}`)).body.data.length, 1, '50 duplicates → one id');
    assert.equal((await flags([m1]))[m1].read_by_customer, false, '?ids= never marks');

    const aget = (customerId: string, q: string) => request(app, 'GET', `/api/admin/communications/${customerId}${q}`, { token: a.token });
    res = await aget(mine.id, `?ids=${foreign},${foreignOwn}`);
    assert.deepEqual([res.status, res.body.data], [200, []], 'an admin passing ids from another customer\'s thread gets none of them');
    res = await aget(mine.id, `?ids=${m2},${foreignOwn}`);
    assert.deepEqual(res.body.data.map((r: { id: string }) => r.id), [m2]);
    assert.equal((await flags([m2]))[m2].read_by_admin, false, '?ids= never marks');
  });

  test('GET ?markRead=false changes nothing; the default GET still marks (dual-run for one release)', async () => {
    const a = await admin('manager');
    const c = await customer();
    const toCustomer = (await adminSends(a, c.id, 'from VHI')).body.data.id;
    const toAdmins = (await customerSends(c, 'from customer')).body.data.id;
    const unread = async (where: string, params: unknown[]) =>
      (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL AND type = 'message.received' AND ${where}`, params)).rows[0].n;

    assert.equal((await request(app, 'GET', '/api/client/communications?markRead=false', { token: c.token })).body.data.length, 2);
    assert.equal((await request(app, 'GET', `/api/admin/communications/${c.id}?markRead=false`, { token: a.token })).body.data.length, 2);
    let f = await flags([toCustomer, toAdmins]);
    assert.deepEqual([f[toCustomer].read_by_customer, f[toAdmins].read_by_admin], [false, false]);
    assert.equal(await unread('customer_id = $1', [c.id]), 1);
    assert.equal(await unread('admin_id = $1', [a.id]), 1);

    await request(app, 'GET', '/api/client/communications', { token: c.token });
    await request(app, 'GET', `/api/admin/communications/${c.id}`, { token: a.token });
    f = await flags([toCustomer, toAdmins]);
    assert.deepEqual([f[toCustomer].read_by_customer, f[toAdmins].read_by_admin], [true, true]);
    assert.equal(await unread('customer_id = $1', [c.id]), 0);
    assert.equal(await unread('admin_id = $1', [a.id]), 0);
  });

  test('customer POST /read: only the given ids from the other side in their own thread; out-of-order message NOT marked', async () => {
    const a = await admin('manager');
    const c = await customer();
    const other = await customer();
    const cs = await connect('client', c.token);
    const rendered = (await adminSends(a, c.id, 'rendered')).body.data.id;
    const own = (await customerSends(c, 'mine')).body.data.id;
    const foreign = (await adminSends(a, other.id, 'not yours')).body.data.id;
    // Committed after the client rendered, but with an EARLIER created_at (out-of-order commit).
    const late = (await adminSends(a, c.id, 'late')).body.data.id;
    await pool.query(`UPDATE communications SET created_at = (SELECT created_at FROM communications WHERE id = $1) - interval '1 second' WHERE id = $2`, [rendered, late]);

    const res = await request(app, 'POST', '/api/client/communications/read', { token: c.token, body: { messageIds: [rendered, own, foreign] } });
    assert.deepEqual([res.status, res.body.data], [200, { updated: 1 }]);
    const f = await flags([rendered, late, foreign, own]);
    assert.equal(f[rendered].read_by_customer, true);
    assert.equal(f[late].read_by_customer, false, 'not rendered → not marked, whatever its created_at');
    assert.equal(f[foreign].read_by_customer, false, 'another customer\'s message is ignored');
    const n = (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE customer_id = $1 AND read_at IS NULL`, [c.id])).rows[0].n;
    assert.equal(n, 1, 'the thread notification stays unread while a message is still unread');
    await cs.waitFor((m) => m.some((x) => x.event === 'thread_read'));
    assert.deepEqual(eventsOf(cs, 'thread_read'), [{ customerId: c.id, side: 'customer' }]);

    // Reading the last one clears the linked notification and pushes `read`.
    await request(app, 'POST', '/api/client/communications/read', { token: c.token, body: { messageIds: [late] } });
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE customer_id = $1 AND read_at IS NULL`, [c.id])).rows[0].n, 0);
    await cs.waitFor((m) => m.some((x) => x.event === 'read'));

    for (const body of [{}, { messageIds: [] }, { messageIds: ['x'] }, { messageIds: Array.from({ length: 201 }, () => crypto.randomUUID()) }, { messageIds: [rendered], extra: 1 }]) {
      assert.equal((await request(app, 'POST', '/api/client/communications/read', { token: c.token, body })).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await request(app, 'POST', '/api/client/communications/read', { body: { messageIds: [rendered] } })).status, 401);
  });

  test('admin POST /:customerId/read: module required, thread-scoped, caller\'s notification read, thread_read to communications admins only', async () => {
    const c = await customer();
    const other = await customer();
    const crm = await admin('crm_officer');
    const support = await admin('support_staff');
    const finance = await admin('finance_officer');
    const watcher = await connect('admin', (await admin('manager')).token);
    const fin = await connect('admin', finance.token);
    const cs = await connect('client', c.token);
    const m1 = (await customerSends(c, 'one')).body.data.id;
    const foreign = (await customerSends(other, 'other thread')).body.data.id;
    const reply = (await adminSends(crm, c.id, 'reply')).body.data.id;

    const read = (who: { token: string }, customerId: string, messageIds: string[]) =>
      request(app, 'POST', `/api/admin/communications/${customerId}/read`, { token: who.token, body: { messageIds } });
    assert.equal((await read(finance, c.id, [m1])).status, 403, 'no communications module (cross-read is GET-only)');
    assert.equal((await read(crm, crypto.randomUUID(), [m1])).status, 404);
    assert.equal((await read(crm, 'nope', [m1])).status, 404);

    const res = await read(crm, c.id, [m1, foreign, reply]);
    assert.deepEqual([res.status, res.body.data], [200, { updated: 1 }]);
    const f = await flags([m1, foreign, reply]);
    assert.equal(f[m1].read_by_admin, true);
    assert.equal(f[foreign].read_by_admin, false, 'ids from another customer\'s thread are ignored');
    const threadUnread = async (adminId: string) =>
      (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE admin_id = $1 AND entity_id = $2 AND read_at IS NULL`, [adminId, c.id])).rows[0].n;
    const crmUnread = await threadUnread(crm.id);
    assert.equal(crmUnread, 0, 'the caller\'s message notification is read');
    const supportUnread = await threadUnread(support.id);
    assert.equal(supportUnread, 1, 'other admins keep their own notification (as before)');

    await watcher.waitFor((m) => m.some((x) => x.event === 'thread_read'));
    assert.deepEqual(eventsOf(watcher, 'thread_read'), [{ customerId: c.id, side: 'admin' }]);
    await sleep(300);
    assert.deepEqual(eventsOf(fin, 'thread_read'), []);
    assert.deepEqual(eventsOf(cs, 'thread_read'), [], 'the customer is not told an admin read their message');

    assert.equal((await read(support, c.id, [m1])).status, 200, 'support staff may mark read (they could via GET before)');
    assert.equal((await read(crm, c.id, [m1])).body.data.updated, 0, 'idempotent');
  });
});
