import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { dbTest, resetDatabase } from './helpers/db';
import { sleep } from './helpers/sse';
import pool from '../src/config/db';
import { chunkEvents, looksLikeTransactionPooler, MAX_PAYLOAD_BYTES, PgNotifyBus } from '../src/modules/notifications/realtime/pgNotifyBus';
import type { NotificationRealtimeEvent as RealtimeEvent } from '../src/modules/notifications/realtime/types';

const ev = (n: number, recipientId = 'r1'): RealtimeEvent => ({
  kind: 'created',
  recipientType: 'admin',
  recipientId,
  notificationIds: Array.from({ length: n }, (_, i) => String(1_000_000_000 + i)),
});

describe('chunkEvents', () => {
  test('small batches fit in one payload', () => {
    const payloads = chunkEvents([ev(1), ev(2, 'r2')]);
    assert.equal(payloads.length, 1);
    assert.deepEqual(JSON.parse(payloads[0]).length, 2);
  });

  test('every payload stays under the byte limit and nothing is lost', () => {
    const events = Array.from({ length: 400 }, (_, i) => ev(3, `recipient-${i}-${'x'.repeat(20)}`));
    const payloads = chunkEvents(events);
    assert.ok(payloads.length > 1);
    for (const p of payloads) assert.ok(Buffer.byteLength(p, 'utf8') <= MAX_PAYLOAD_BYTES, `payload ${Buffer.byteLength(p)}`);
    assert.equal(payloads.flatMap((p) => JSON.parse(p)).length, 400);
  });

  test('a single oversized event is split by id list', () => {
    const big = ev(2000);
    big.replacedIds = Array.from({ length: 50 }, (_, i) => String(i));
    const payloads = chunkEvents([big]);
    assert.ok(payloads.length > 1);
    for (const p of payloads) assert.ok(Buffer.byteLength(p, 'utf8') <= MAX_PAYLOAD_BYTES);
    const parts: RealtimeEvent[] = payloads.flatMap((p) => JSON.parse(p));
    assert.deepEqual(parts.flatMap((e) => e.notificationIds), big.notificationIds);
    assert.deepEqual(parts.flatMap((e) => e.replacedIds ?? []), big.replacedIds);
    assert.ok(parts.every((e) => e.kind === 'created' && e.recipientId === 'r1'));
  });

  test('transaction-pooler URLs are detected for the startup warning', () => {
    assert.equal(looksLikeTransactionPooler('postgresql://u:p@pooler.example.com:6543/postgres'), true);
    assert.equal(looksLikeTransactionPooler('postgresql://u:p@host:5432/db?pgbouncer=true'), true);
    assert.equal(looksLikeTransactionPooler('postgresql://u:p@pooler.example.com:5432/postgres'), false);
    assert.equal(looksLikeTransactionPooler('not a url'), false);
  });
});

describe('PgNotifyBus on the test database', dbTest, () => {
  const url = process.env.TEST_DATABASE_URL!;
  const quiet = { warn: () => {}, error: () => {}, info: () => {} };
  let busA: PgNotifyBus;
  let busB: PgNotifyBus;
  const receivedA: RealtimeEvent[] = [];
  const receivedB: RealtimeEvent[] = [];

  before(async () => {
    await resetDatabase();
    busA = new PgNotifyBus({ connectionString: url, minBackoffMs: 50, maxBackoffMs: 200, log: quiet });
    busB = new PgNotifyBus({ connectionString: url, minBackoffMs: 50, maxBackoffMs: 200, log: quiet });
    busA.subscribe((events) => receivedA.push(...(events as RealtimeEvent[])));
    busB.subscribe((events) => receivedB.push(...(events as RealtimeEvent[])));
    await busA.start();
    await busB.start();
  });
  after(async () => {
    await busA?.stop();
    await busB?.stop();
    await pool.end();
  });

  const waitUntil = async (fn: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error('timed out');
      await sleep(20);
    }
  };

  async function publishIn(finish: 'COMMIT' | 'ROLLBACK', events: RealtimeEvent[]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await busA.publish(events, client);
      await client.query(finish);
    } finally {
      client.release();
    }
  }

  test('NOTIFY is delivered on COMMIT only; a rollback delivers nothing', async () => {
    receivedA.length = 0;
    await publishIn('ROLLBACK', [ev(1, 'rolled-back')]);
    await sleep(300);
    assert.equal(receivedA.filter((e) => e.recipientId === 'rolled-back').length, 0);
    await publishIn('COMMIT', [ev(1, 'committed')]);
    await waitUntil(() => receivedA.some((e) => e.recipientId === 'committed'));
  });

  test('two bus instances on one database both receive (multi-instance)', async () => {
    receivedA.length = 0;
    receivedB.length = 0;
    await publishIn('COMMIT', [ev(2, 'both')]);
    await waitUntil(() => receivedA.some((e) => e.recipientId === 'both') && receivedB.some((e) => e.recipientId === 'both'));
  });

  test('a dropped LISTEN connection reconnects and re-subscribes', async () => {
    const pid = busA.listenerPid();
    assert.ok(pid);
    const admin = new Client({ connectionString: url });
    await admin.connect();
    try {
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    } finally {
      await admin.end();
    }
    await waitUntil(() => !busA.isListening() || busA.listenerPid() !== pid, 3000);
    await waitUntil(() => busA.isListening() && busA.listenerPid() !== pid, 5000);
    receivedA.length = 0;
    await publishIn('COMMIT', [ev(1, 'after-reconnect')]);
    await waitUntil(() => receivedA.some((e) => e.recipientId === 'after-reconnect'));
  });
});
