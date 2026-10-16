import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, TestApp } from './helpers/app';
import { customerToken, insertCustomer, insertShipment } from './helpers/fixtures';
import { sleep } from './helpers/sse';
import pool from '../src/config/db';
import { customerMiddleware } from '../src/middleware/customerMiddleware';
import { emit } from '../src/modules/notifications/notification.service';
import type { NotificationEvent } from '../src/modules/notifications/events';
import { PgNotifyBus } from '../src/modules/notifications/realtime/pgNotifyBus';
import { SseHub, SseHubConfig } from '../src/modules/notifications/realtime/sseHub';
import { adminVisibility, createStreamHandler, fetchPushRows } from '../src/modules/notifications/realtime';

// Shared front-end stream client (byte-identical in both apps; see realtime.clientModules.test.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ns = require(path.join(__dirname, '../../../app/src/lib/notificationStream.ts'));

const quiet = { warn: () => {}, error: () => {}, info: () => {} };
const fixed = (r: number) => () => r;

describe('notificationStream retry policy (pure)', () => {
  const s0 = ns.initialRetryState;

  test('failures back off exponentially with jitter, capped at 30s; `ready` resets via attempt 0', () => {
    let state = s0;
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const next = ns.nextRetry(state, { kind: 'failed' }, fixed(1), 0);
      delays.push(next.delayMs);
      state = next.state;
    }
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    assert.equal(ns.nextRetry(s0, { kind: 'failed' }, fixed(0), 0).delayMs, 500, 'jitter floor is half the step');
  });

  test('clean server end: random 0–5s, then normal backoff from the start', () => {
    const tired = { attempt: 5, reauthStreak: 1 };
    assert.equal(ns.nextRetry(tired, { kind: 'ended' }, fixed(0), 0).delayMs, 0);
    const end = ns.nextRetry(tired, { kind: 'ended' }, fixed(1), 0);
    assert.equal(end.delayMs, 5000);
    assert.deepEqual(end.state, { attempt: 0, reauthStreak: 0 });
    assert.equal(ns.nextRetry(end.state, { kind: 'failed' }, fixed(1), 0).delayMs, 1000);
  });

  test('429/503 wait Retry-After (60s default); 401 stops', () => {
    assert.equal(ns.nextRetry(s0, { kind: 'throttled', retryAfterMs: null }, fixed(0), 0).delayMs, 60000);
    assert.equal(ns.nextRetry(s0, { kind: 'throttled', retryAfterMs: 15000 }, fixed(0), 0).delayMs, 15000);
    assert.equal(ns.nextRetry(s0, { kind: 'unauthorized' }, fixed(0), 0).delayMs, null);
  });

  test('reauth: reconnect at once; again with the same token, wait until it expires', () => {
    const first = ns.nextRetry(s0, { kind: 'reauth', sameToken: true, expiresAtMs: 70_000 }, fixed(0), 10_000);
    assert.equal(first.delayMs, 0);
    const second = ns.nextRetry(first.state, { kind: 'reauth', sameToken: true, expiresAtMs: 70_000 }, fixed(0), 10_000);
    assert.equal(second.delayMs, 61_000, 'until exp + 1s grace');
    const changed = ns.nextRetry(second.state, { kind: 'reauth', sameToken: false, expiresAtMs: 70_000 }, fixed(0), 10_000);
    assert.equal(changed.delayMs, 0, 'a new token reconnects at once');
    const unknownExp = ns.nextRetry(first.state, { kind: 'reauth', sameToken: true, expiresAtMs: null }, fixed(1), 0);
    assert.equal(unknownExp.delayMs, 1000, 'unreadable token: normal backoff');
  });

  test('tokenExpiryMs reads exp from a JWT and returns null for anything else', () => {
    const token = jwt.sign({ id: 'x' }, 'k', { expiresIn: 3600 });
    const exp = (jwt.decode(token) as { exp: number }).exp * 1000;
    assert.equal(ns.tokenExpiryMs(token), exp);
    assert.equal(ns.tokenExpiryMs('not-a-jwt'), null);
    assert.equal(ns.tokenExpiryMs('a.!!!.c'), null);
    assert.equal(ns.tokenExpiryMs(jwt.sign({ id: 'x' }, 'k', { noTimestamp: true })), null);
  });

  test('toPushEvent maps known events and drops malformed ones', () => {
    assert.deepEqual(ns.toPushEvent('read', '{"ids":["1","2"]}'), { type: 'read', ids: ['1', '2'] });
    assert.deepEqual(ns.toPushEvent('replaced', '{"removedIds":["1"],"addedIds":["2"]}'), {
      type: 'replaced',
      removedIds: ['1'],
      addedIds: ['2'],
    });
    assert.equal(ns.toPushEvent('notification', '{"id":"5","title":"t"}').notification.id, '5');
    assert.equal(ns.toPushEvent('notification', '{"title":"no id"}'), null);
    assert.equal(ns.toPushEvent('read', '{"ids":[1]}'), null);
    assert.equal(ns.toPushEvent('read', 'not json'), null);
    assert.equal(ns.toPushEvent('mystery', '{}'), null);
  });

  test('toPushEvent maps the communications events (ids only) and drops malformed ones', () => {
    assert.deepEqual(ns.toPushEvent('message_created', '{"customerId":"c1","messageId":"m1","senderType":"admin"}'), {
      type: 'message_created',
      customerId: 'c1',
      messageId: 'm1',
      senderType: 'admin',
    });
    assert.deepEqual(ns.toPushEvent('thread_read', '{"customerId":"c1","side":"customer"}'), { type: 'thread_read', customerId: 'c1', side: 'customer' });
    assert.equal(ns.toPushEvent('message_created', '{"customerId":"c1","messageId":"m1","senderType":"robot"}'), null);
    assert.equal(ns.toPushEvent('message_created', '{"customerId":"c1"}'), null);
    assert.equal(ns.toPushEvent('thread_read', '{"customerId":"c1","side":"both"}'), null);
    assert.equal(ns.toPushEvent('thread_read', '{"customerId":7,"side":"admin"}'), null);
  });
});

// Minimal in-process Web Locks (exclusive, FIFO, abortable while waiting) to run several "tabs" in one process.
function fakeLocks() {
  const held = new Set<string>();
  const queues = new Map<string, Array<() => void>>();
  return {
    request(name: string, opts: { signal?: AbortSignal }, cb: () => Promise<void>) {
      return new Promise<void>((resolve, reject) => {
        const run = () => {
          held.add(name);
          Promise.resolve()
            .then(cb)
            .then(() => resolve(), reject)
            .finally(() => {
              held.delete(name);
              queues.get(name)?.shift()?.();
            });
        };
        if (!held.has(name)) return run();
        const queue = queues.get(name) ?? [];
        queues.set(name, queue);
        const onAbort = () => {
          const i = queue.indexOf(entry);
          if (i >= 0) queue.splice(i, 1);
          reject(new Error('AbortError'));
        };
        const entry = () => {
          opts.signal?.removeEventListener('abort', onAbort);
          run();
        };
        opts.signal?.addEventListener('abort', onAbort);
        queue.push(entry);
      });
    },
  };
}

describe('notificationStream against a real stream endpoint', dbTest, () => {
  let app: TestApp;
  let bus: PgNotifyBus;
  let hub: SseHub;
  const streams: { stop(): void }[] = [];
  const CONFIG: SseHubConfig = {
    heartbeatMs: 200,
    maxPerUser: 2,
    maxConnections: 20,
    connectsPerMinute: 100,
    drainTimeoutMs: 200,
    reauthLeadMs: 1000,
  };

  before(async () => {
    await resetDatabase();
    bus = new PgNotifyBus({ connectionString: process.env.TEST_DATABASE_URL!, minBackoffMs: 50, maxBackoffMs: 200, log: quiet });
    await bus.start();
    hub = new SseHub(CONFIG, { bus, fetchRows: fetchPushRows, adminVisibility, log: quiet });
    const client = Router();
    client.use(customerMiddleware);
    client.get('/stream', createStreamHandler(hub, 'customer'));
    app = await startApp([['/t/client', client]]);
  });

  beforeEach(async () => {
    while (streams.length) streams.pop()!.stop();
    await waitFor(() => hub.stats().connections === 0, 3000).catch(() => {});
    await truncateAll();
  });

  after(async () => {
    while (streams.length) streams.pop()!.stop();
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

  // A "tab": its own events, connection flag and fetch counter.
  function tab(token: () => string | null, extra: Record<string, unknown> = {}) {
    const t = {
      events: [] as any[],
      connected: false,
      unauthorized: 0,
      fetches: 0,
      stream: null as null | { stop(): void },
    };
    t.stream = ns.startNotificationStream({
      name: 'test-notifications',
      url: `${app.url}/t/client/stream`,
      getToken: token,
      onEvent: (e: any) => t.events.push(e),
      onConnectedChange: (v: boolean) => (t.connected = v),
      onUnauthorized: () => t.unauthorized++,
      fetch: (input: any, init: any) => {
        t.fetches++;
        return fetch(input, init);
      },
      random: () => 0,
      locks: null,
      createChannel: null,
      ...extra,
    });
    streams.push(t.stream!);
    return t;
  }

  async function emitFor(customer: any) {
    const shipment = await insertShipment(customer.id);
    const event: NotificationEvent = {
      type: 'shipment.created_for_customer',
      actor: { type: 'admin', id: null },
      sourceId: shipment.id,
      shipment: { id: shipment.id, orderId: shipment.order_id, customerId: customer.id, status: 'pending' },
    };
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await emit(event, c);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    return shipment;
  }

  test('connects, reports `ready`, receives a pushed notification, and stop() closes it for good', async () => {
    const customer = await insertCustomer();
    const token = customerToken(customer);
    const t = tab(() => token);
    await waitFor(() => t.connected);
    assert.deepEqual(t.events[0], { type: 'ready' });
    const shipment = await emitFor(customer);
    await waitFor(() => t.events.some((e) => e.type === 'notification'));
    const pushed = t.events.find((e) => e.type === 'notification').notification;
    assert.equal(pushed.orderId, shipment.order_id);
    t.stream!.stop();
    assert.equal(t.connected, false);
    await waitFor(() => hub.stats().connections === 0);
    await sleep(300);
    assert.equal(t.fetches, 1, 'no reconnect after stop()');
  });

  test('401 and a missing token stop the stream and call onUnauthorized once', async () => {
    const bad = tab(() => 'not-a-valid-token');
    await waitFor(() => bad.unauthorized === 1);
    const none = tab(() => null);
    await waitFor(() => none.unauthorized === 1);
    await sleep(300);
    assert.equal(bad.fetches, 1);
    assert.equal(none.fetches, 0);
    assert.equal(bad.unauthorized + none.unauthorized, 2);
  });

  test('reauth near expiry: one immediate reconnect, then wait for the token to expire (no loop)', async () => {
    const customer = await insertCustomer();
    // Expires within reauthLeadMs, so the server sends `reauth` right after `ready`.
    const token = jwt.sign({ id: customer.id, email: customer.email, userId: customer.user_id }, process.env.CLIENT_JWT_SECRET!, {
      expiresIn: 2,
    });
    const t = tab(() => token);
    await waitFor(() => t.fetches === 2, 3000);
    await sleep(600);
    assert.equal(t.fetches, 2, 'the second reauth with the same token waits for expiry');
    assert.equal(t.unauthorized, 0);
    await waitFor(() => t.unauthorized === 1, 6000);
    assert.equal(t.fetches, 3, 'after expiry the reconnect gets 401');
  });

  test('reauth with a new token available reconnects at once and stays connected', async () => {
    const customer = await insertCustomer();
    // Expires within reauthLeadMs: `reauth` arrives right after `ready`. By then a fresh token is in storage
    // (e.g. signed in again in another tab), so the first getToken() call returns the old one, later calls the new one.
    const old = jwt.sign({ id: customer.id, email: customer.email, userId: customer.user_id }, process.env.CLIENT_JWT_SECRET!, {
      expiresIn: 1,
    });
    const fresh = customerToken(customer);
    let reads = 0;
    const t = tab(() => (reads++ === 0 ? old : fresh));
    await waitFor(() => t.fetches === 2 && t.connected, 3000);
    await sleep(400);
    assert.equal(t.fetches, 2);
    assert.equal(t.connected, true);
  });

  test('429 (per-user cap) is not retried immediately', async () => {
    const customer = await insertCustomer();
    const token = customerToken(customer);
    const a = tab(() => token);
    const b = tab(() => token);
    await waitFor(() => a.connected && b.connected);
    const c = tab(() => token);
    await sleep(500);
    assert.equal(c.fetches, 1);
    assert.equal(c.connected, false);
    assert.equal(c.unauthorized, 0);
  });

  test('a clean server end reconnects after the 0–5s jitter (random=0 → at once) and fires `ready` again', async () => {
    const customer = await insertCustomer();
    const token = customerToken(customer);
    let calls = 0;
    // First response: a healthy stream that the "server" ends cleanly; then the real endpoint.
    const t = tab(() => token, {
      fetch: (input: any, init: any) => {
        calls++;
        if (calls === 1) {
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));
              controller.close();
            },
          });
          return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
        }
        return fetch(input, init);
      },
    });
    await waitFor(() => calls === 2 && t.connected, 3000);
    assert.equal(t.events.filter((e) => e.type === 'ready').length, 2);
  });

  test('two tabs share one stream; both get pushes; closing the leader hands over to the other tab', async () => {
    const customer = await insertCustomer();
    const token = customerToken(customer);
    const locks = fakeLocks();
    const shared = { locks, createChannel: (name: string) => new BroadcastChannel(name) };
    const leader = tab(() => token, shared);
    await waitFor(() => leader.connected);
    const follower = tab(() => token, shared);
    await waitFor(() => follower.connected, 2000); // learned from the leader's status reply
    await sleep(200);
    assert.equal(hub.stats().connections, 1, 'one stream for both tabs');
    assert.equal(follower.fetches, 0);

    await emitFor(customer);
    await waitFor(() => leader.events.some((e) => e.type === 'notification') && follower.events.some((e) => e.type === 'notification'));

    leader.stream!.stop();
    await waitFor(() => follower.fetches === 1 && follower.connected, 3000);
    assert.equal(hub.stats().connections, 1, 'the other tab took over');
    await emitFor(customer);
    await waitFor(() => follower.events.filter((e) => e.type === 'notification').length === 2);
  });
});
