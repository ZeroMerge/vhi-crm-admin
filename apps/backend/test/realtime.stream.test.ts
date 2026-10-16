import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import path from 'path';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, customerToken, insertAdmin, insertCustomer, insertShipment } from './helpers/fixtures';
import { eventsOf, openStream, sleep, SseConnection } from './helpers/sse';
import pool from '../src/config/db';
import { adminMiddleware } from '../src/middleware/adminMiddleware';
import { customerMiddleware } from '../src/middleware/customerMiddleware';
import { clearAdminAccountCache, requireActiveAdmin } from '../src/middleware/permissions';
import { emit } from '../src/modules/notifications/notification.service';
import type { NotificationEvent } from '../src/modules/notifications/events';
import { adminNotificationsRoutes, clientNotificationsRoutes } from '../src/modules/notifications/notifications.routes';
import { PgNotifyBus } from '../src/modules/notifications/realtime/pgNotifyBus';
import { SseHub, SseHubConfig } from '../src/modules/notifications/realtime/sseHub';
import { adminVisibility, createStreamHandler, fetchPushRows, publishRealtime } from '../src/modules/notifications/realtime';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cache = require(path.join(__dirname, '../../../app/src/lib/notificationCache.ts'));

const quiet = { warn: () => {}, error: () => {}, info: () => {} };
const BASE_CONFIG: SseHubConfig = {
  heartbeatMs: 200,
  maxPerUser: 3,
  maxConnections: 6,
  connectsPerMinute: 100,
  drainTimeoutMs: 200,
  reauthLeadMs: 1000,
};

describe('SSE notification streams', dbTest, () => {
  let app: TestApp;
  let bus: PgNotifyBus;
  let hub: SseHub;
  const open: SseConnection[] = [];

  function streamRouters(h: SseHub) {
    const admin = Router();
    admin.use(adminMiddleware, requireActiveAdmin);
    admin.get('/stream', createStreamHandler(h, 'admin'));
    const client = Router();
    client.use(customerMiddleware);
    client.get('/stream', createStreamHandler(h, 'customer'));
    return { admin, client };
  }

  before(async () => {
    await resetDatabase();
    bus = new PgNotifyBus({ connectionString: process.env.TEST_DATABASE_URL!, minBackoffMs: 50, maxBackoffMs: 200, log: quiet });
    await bus.start();
    hub = new SseHub(BASE_CONFIG, { bus, fetchRows: fetchPushRows, adminVisibility, log: quiet });
    const r = streamRouters(hub);
    app = await startApp([
      ['/t/admin', r.admin],
      ['/t/client', r.client],
      ['/api/admin/notifications', adminNotificationsRoutes],
      ['/api/client/notifications', clientNotificationsRoutes],
    ]);
  });

  beforeEach(async () => {
    while (open.length) open.pop()!.close();
    await waitFor(() => hub.stats().connections === 0, 3000).catch(() => {});
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

  async function waitFor(fn: () => boolean, ms = 3000) {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error('timed out');
      await sleep(20);
    }
  }
  async function connect(kind: 'admin' | 'client', token: string) {
    const conn = await openStream(`${app.url}/t/${kind}/stream`, token);
    open.push(conn);
    if (conn.status === 200) await conn.waitFor((m) => m.some((x) => x.event === 'ready'));
    return conn;
  }
  async function emitInTx(event: NotificationEvent) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await emit(event, client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }
  const forCustomer = (c: any, s: any): NotificationEvent => ({
    type: 'shipment.created_for_customer',
    actor: { type: 'admin', id: null },
    sourceId: s.id,
    shipment: { id: s.id, orderId: s.order_id, customerId: c.id, status: 'pending' },
  });
  const tokenFor = (a: any, role: string) => adminToken({ id: a.id, email: a.email, activeRole: role });

  test('connect: SSE headers, `ready` first, heartbeat comments', async () => {
    const c = await insertCustomer();
    const conn = await connect('client', customerToken(c));
    assert.equal(conn.status, 200);
    assert.match(conn.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.equal(conn.headers.get('cache-control'), 'no-cache, no-transform');
    assert.equal(conn.headers.get('x-accel-buffering'), 'no');
    assert.equal(conn.messages[0].event, 'ready');
    await waitFor(() => conn.raw.includes(': ping'), 2000);
    assert.ok(!conn.raw.includes('\nid:') && !conn.raw.startsWith('id:'), 'no id: lines are sent');
  });

  test('routing: only the recipient\x27s connections receive; payload is whitelisted', async () => {
    const a = await insertCustomer();
    const b = await insertCustomer();
    const s = await insertShipment(a.id);
    const ca1 = await connect('client', customerToken(a));
    const ca2 = await connect('client', customerToken(a));
    const cb = await connect('client', customerToken(b));
    await emitInTx(forCustomer(a, s));
    await ca1.waitFor((m) => m.some((x) => x.event === 'notification'));
    await ca2.waitFor((m) => m.some((x) => x.event === 'notification'));
    await sleep(200);
    assert.equal(eventsOf(cb, 'notification').length, 0);

    const [n] = eventsOf(ca1, 'notification');
    assert.deepEqual(Object.keys(n).sort(), ['body', 'createdAt', 'entityId', 'entityType', 'id', 'orderId', 'title', 'type']);
    assert.equal(n.orderId, s.order_id);
    assert.equal(n.entityId, s.id);
    assert.ok(!JSON.stringify(n).includes('@'), 'no email addresses in the payload');
    assert.ok(!('data' in n) && !('module' in n) && !('customerId' in n));
    assert.equal(eventsOf(ca2, 'notification').length, 1, 'delivered once per connection');
  });

  test('admin pushes are re-checked against the admin\x27s CURRENT roles at push time', async () => {
    const a = await insertAdmin({ assignedRoles: ['finance_officer', 'logistics_officer'] });
    const conn = await connect('admin', tokenFor(a, 'finance_officer'));
    const insertComms = async () => {
      const { rows } = await pool.query(
        `INSERT INTO notifications (admin_id, module, type, entity_type, entity_id, title, body, actor_type, dedupe_key)
         VALUES ($1, 'communications', 'message.received', 'customer_thread', gen_random_uuid(), 'T', 'B', 'system', gen_random_uuid()::text) RETURNING id`,
        [a.id]
      );
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await publishRealtime([{ kind: 'created', recipientType: 'admin', recipientId: a.id, notificationIds: [String(rows[0].id)] }], client);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      return String(rows[0].id);
    };
    const first = await insertComms();
    await conn.waitFor((m) => m.some((x) => x.event === 'notification'));
    assert.equal(eventsOf(conn, 'notification')[0].id, first);

    await pool.query(`UPDATE admins SET assigned_roles = ARRAY['finance_officer'] WHERE id = $1`, [a.id]);
    clearAdminAccountCache(a.id);
    await insertComms();
    await sleep(400);
    assert.equal(eventsOf(conn, 'notification').length, 1, 'communications row no longer pushed after losing logistics_officer');
    assert.equal(conn.ended, false, 'stream stays open: the active role is still assigned');
  });

  test('removing the token\x27s active role or deactivating the admin ends the stream with reauth', async () => {
    for (const change of [`UPDATE admins SET assigned_roles = ARRAY['manager'] WHERE id = $1`, `UPDATE admins SET is_active = false WHERE id = $1`]) {
      const a = await insertAdmin({ assignedRoles: ['crm_officer', 'manager'] });
      const conn = await connect('admin', tokenFor(a, 'crm_officer'));
      await pool.query(change, [a.id]);
      clearAdminAccountCache(a.id);
      const c = await insertCustomer();
      await emitInTx({ type: 'message.received', actor: { type: 'customer', id: c.id }, sourceId: c.id, customerId: c.id, direction: 'to_admins', text: 'hi' });
      await conn.waitForEnd(3000);
      assert.ok(conn.messages.some((m) => m.event === 'reauth'), change);
      assert.equal(eventsOf(conn, 'notification').length, 0);
    }
  });

  test('inactive admin gets 401 at connect', async () => {
    const a = await insertAdmin({ assignedRoles: ['manager'], isActive: false });
    const conn = await openStream(`${app.url}/t/admin/stream`, tokenFor(a, 'manager'));
    assert.equal(conn.status, 401);
  });

  test('token expiry: `reauth` is sent shortly before exp, then the stream ends', async () => {
    const c = await insertCustomer();
    const token = jwt.sign({ id: c.id, email: c.email, userId: c.user_id }, process.env.CLIENT_JWT_SECRET!, { expiresIn: 2 });
    const conn = await connect('client', token);
    await conn.waitForEnd(4000);
    assert.equal(conn.messages[conn.messages.length - 1].event, 'reauth');
    await waitFor(() => hub.stats().connections === 0);
  });

  test('per-user cap → 429 (oldest is kept), global cap → 503', async () => {
    const c = await insertCustomer();
    const t = customerToken(c);
    const kept = [await connect('client', t), await connect('client', t), await connect('client', t)];
    const over = await openStream(`${app.url}/t/client/stream`, t);
    assert.equal(over.status, 429);
    assert.ok(kept.every((k) => !k.ended), 'existing tabs are not closed');

    const others = [];
    for (let i = 0; i < 3; i++) others.push(await connect('client', customerToken(await insertCustomer())));
    assert.equal(hub.stats().connections, 6);
    const full = await openStream(`${app.url}/t/client/stream`, customerToken(await insertCustomer()));
    assert.equal(full.status, 503);
  });

  test('connect rate limit → 429', async () => {
    const limited = new SseHub({ ...BASE_CONFIG, connectsPerMinute: 3 }, { bus, fetchRows: fetchPushRows, adminVisibility, log: quiet });
    const r = streamRouters(limited);
    const app2 = await startApp([['/t/client', r.client]]);
    try {
      const c = await insertCustomer();
      const t = customerToken(c);
      for (let i = 0; i < 3; i++) {
        const conn = await openStream(`${app2.url}/t/client/stream`, t);
        assert.equal(conn.status, 200);
        conn.close();
      }
      const fourth = await openStream(`${app2.url}/t/client/stream`, t);
      assert.equal(fourth.status, 429);
      assert.equal(fourth.body?.success, false);
    } finally {
      limited.shutdown();
      await app2.close();
    }
  });

  test('disconnect cleans up: no connections, timers or listeners left', async () => {
    const c = await insertCustomer();
    const conns = [await connect('client', customerToken(c)), await connect('client', customerToken(c))];
    assert.ok(hub.stats().timers >= 2);
    conns.forEach((x) => x.close());
    await waitFor(() => hub.stats().connections === 0);
    assert.deepEqual(hub.stats(), { connections: 0, recipients: 0, timers: 0 });
  });

  test('read and read_all reach only that user\x27s other connections', async () => {
    const a = await insertAdmin({ assignedRoles: ['manager'] });
    const other = await insertAdmin({ assignedRoles: ['manager'] });
    const tab1 = await connect('admin', tokenFor(a, 'manager'));
    const tab2 = await connect('admin', tokenFor(a, 'manager'));
    const otherTab = await connect('admin', tokenFor(other, 'manager'));
    const c = await insertCustomer();
    for (const text of ['one']) {
      await emitInTx({ type: 'message.received', actor: { type: 'customer', id: c.id }, sourceId: c.id, customerId: c.id, direction: 'to_admins', text });
    }
    await tab1.waitFor((m) => m.some((x) => x.event === 'notification'));
    const id = eventsOf(tab1, 'notification')[0].id;

    const r = await request(app, 'POST', `/api/admin/notifications/${id}/read`, { token: tokenFor(a, 'manager') });
    assert.equal(r.status, 200);
    await tab2.waitFor((m) => m.some((x) => x.event === 'read'));
    assert.deepEqual(eventsOf(tab2, 'read')[0], { ids: [id] });
    await tab1.waitFor((m) => m.some((x) => x.event === 'read'));

    // Re-marking an already-read row publishes nothing.
    await request(app, 'POST', `/api/admin/notifications/${id}/read`, { token: tokenFor(a, 'manager') });
    await sleep(300);
    assert.equal(eventsOf(tab2, 'read').length, 1);

    await emitInTx({ type: 'shipment.created', actor: { type: 'customer', id: c.id }, sourceId: (await insertShipment(c.id)).id,
      shipment: { id: (await insertShipment(c.id)).id, orderId: 'X1', customerId: c.id, shippingMode: 'air_freight' } });
    await tab2.waitFor((m) => eventsOf(tab2, 'notification').length >= 2 && m.length > 0);
    assert.equal((await request(app, 'POST', '/api/admin/notifications/read-all', { token: tokenFor(a, 'manager') })).status, 200);
    await tab1.waitFor((m) => m.some((x) => x.event === 'read_all'));
    await tab2.waitFor((m) => m.some((x) => x.event === 'read_all'));
    await sleep(300);
    assert.equal(eventsOf(otherTab, 'read').length + eventsOf(otherTab, 'read_all').length, 0, 'other admin unaffected');
  });

  test('message grouping pushes the new row and a `replaced` event for the old one', async () => {
    const c = await insertCustomer();
    const conn = await connect('client', customerToken(c));
    const send = (text: string) =>
      emitInTx({ type: 'message.received', actor: { type: 'admin', id: null }, sourceId: crypto.randomUUID(), customerId: c.id, direction: 'to_customer', text });
    await send('first');
    await conn.waitFor(() => eventsOf(conn, 'notification').length === 1);
    await send('second');
    await conn.waitFor((m) => m.some((x) => x.event === 'replaced') && eventsOf(conn, 'notification').length === 2);
    const [first, second] = eventsOf(conn, 'notification');
    const order = conn.messages.map((m) => m.event).filter((e) => e !== 'ready');
    assert.deepEqual(order, ['notification', 'notification', 'replaced'], 'replacement arrives before the old row is removed');
    assert.deepEqual(eventsOf(conn, 'replaced')[0], { removedIds: [first.id], addedIds: [second.id] });
    assert.equal(second.title, '2 new messages from VHI Support');
  });

  test('(a) committed after registration but before the client\x27s REST refetch: shows exactly once', async () => {
    const c = await insertCustomer();
    const s = await insertShipment(c.id);
    const conn = await connect('client', customerToken(c)); // `ready` received: client would refetch now
    await emitInTx(forCustomer(c, s)); // commits before the refetch runs
    const list = await request(app, 'GET', '/api/client/notifications', { token: customerToken(c) });
    const count = await request(app, 'GET', '/api/client/notifications/unread-count', { token: customerToken(c) });
    await conn.waitFor((m) => m.some((x) => x.event === 'notification'));
    const pushed = eventsOf(conn, 'notification')[0];

    // Cache after the refetch, then the push arrives (no fetch in flight).
    const state = {
      list: { pages: [{ data: list.body.data, nextCursor: list.body.nextCursor }], pageParams: [undefined] },
      listFetching: false,
      count: count.body.data,
      countFetching: false,
    };
    const plan = cache.planPushUpdate(state, { type: 'notification', notification: pushed }, (n: any) => ({ ...n, readAt: null }), 'now');
    assert.equal(plan.list, undefined, 'already in the list: no duplicate added');
    assert.equal(plan.count, undefined, 'count is not incremented a second time');
    assert.equal(plan.invalidateCount, true, 'ambiguous count is refetched instead');
    assert.equal(count.body.data.count, 1);
    assert.equal(count.body.data.latestId, pushed.id);
  });

  test('a notification for a newer id than latestId increments the count without a refetch', async () => {
    const c = await insertCustomer();
    const count = await request(app, 'GET', '/api/client/notifications/unread-count', { token: customerToken(c) });
    assert.deepEqual(count.body.data, { count: 0, latestId: null });
    const conn = await connect('client', customerToken(c));
    await emitInTx(forCustomer(c, await insertShipment(c.id)));
    await conn.waitFor((m) => m.some((x) => x.event === 'notification'));
    const pushed = eventsOf(conn, 'notification')[0];
    const plan = cache.planPushUpdate({ list: undefined, listFetching: false, count: count.body.data, countFetching: false },
      { type: 'notification', notification: pushed }, (n: any) => n, 'now');
    assert.deepEqual(plan.count, { count: 1, latestId: pushed.id });
    assert.equal(plan.invalidateCount, false);
  });

  test('slow client: no drain within the timeout drops the connection; a drain in time keeps it', async () => {
    class FakeRes extends EventEmitter {
      writes = 0;
      destroyed = false;
      constructor(private accept: boolean) { super(); }
      write() { this.writes++; return this.accept; }
      end() {}
      destroy() { this.destroyed = true; }
    }
    const h = new SseHub({ ...BASE_CONFIG, heartbeatMs: 60_000 }, { bus, fetchRows: fetchPushRows, adminVisibility, log: quiet });
    try {
      const slowReq = new EventEmitter();
      const slow = new FakeRes(false);
      h.register(slowReq as any, slow as any, 'customer', 'c-slow', null);
      await sleep(350);
      assert.equal(slow.destroyed, true);
      assert.equal(h.stats().connections, 0);
      assert.equal(slow.listenerCount('drain'), 0);
      assert.equal(slowReq.listenerCount('close'), 0);

      const okReq = new EventEmitter();
      const ok = new FakeRes(false);
      h.register(okReq as any, ok as any, 'customer', 'c-ok', null);
      setTimeout(() => ok.emit('drain'), 50);
      await sleep(350);
      assert.equal(ok.destroyed, false);
      assert.equal(h.stats().connections, 1);
      okReq.emit('close');
      assert.deepEqual(h.stats(), { connections: 0, recipients: 0, timers: 0 });
      assert.equal(ok.listenerCount('drain'), 0);
    } finally {
      h.shutdown();
    }
  });

  test('shutdown ends every stream and clears all state; REST still works without LISTEN', async () => {
    const h = new SseHub(BASE_CONFIG, { bus, fetchRows: fetchPushRows, adminVisibility, log: quiet });
    const r = streamRouters(h);
    const app3 = await startApp([['/t/client', r.client], ['/api/client/notifications', clientNotificationsRoutes]]);
    try {
      const c = await insertCustomer();
      const conn = await openStream(`${app3.url}/t/client/stream`, customerToken(c));
      await conn.waitFor((m) => m.some((x) => x.event === 'ready'));
      h.shutdown();
      await conn.waitForEnd(3000);
      assert.deepEqual(h.stats(), { connections: 0, recipients: 0, timers: 0 });

      const stopped = new PgNotifyBus({ connectionString: 'postgresql://nobody@127.0.0.1:1/none', log: quiet });
      assert.equal(stopped.isListening(), false);
      const list = await request(app3, 'GET', '/api/client/notifications', { token: customerToken(c) });
      assert.equal(list.status, 200, 'REST is independent of LISTEN');
    } finally {
      await app3.close();
    }
  });
});
