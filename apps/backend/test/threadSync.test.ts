import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

// Pure front-end helpers shared by both apps (byte-identical copies; see realtime.clientModules.test.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require(path.join(__dirname, '../../../app/src/lib/threadSync.ts'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cache = require(path.join(__dirname, '../../../app/src/lib/notificationCache.ts'));

const msg = (id: string, createdAt: string, senderType?: 'admin' | 'customer', extra = {}) => ({ id, createdAt, senderType, ...extra });
const ids = (list: Array<{ id: string }>) => list.map((m) => m.id);

describe('mergeMessages', () => {
  test('dedupes by id (incoming wins), orders by time, stable for equal times, new items after existing ones', () => {
    const existing = [msg('a', '2026-10-07T10:00:00Z'), msg('b', '2026-10-07T10:00:05Z', 'admin', { body: 'old' })];
    const incoming = [msg('c', '2026-10-07T10:00:03Z'), msg('b', '2026-10-07T10:00:05Z', 'admin', { body: 'new' }), msg('d', '2026-10-07T10:00:05Z')];
    const merged = ts.mergeMessages(existing, incoming);
    assert.deepEqual(ids(merged), ['a', 'c', 'b', 'd']);
    assert.equal(merged[2].body, 'new');
    assert.deepEqual(ts.mergeMessages(merged, incoming), merged, 'idempotent: the same push twice changes nothing');
  });

  test('a push for a message the fetch already returned does not duplicate it; unreadable times go last', () => {
    const merged = ts.mergeMessages([msg('a', '2026-10-07T10:00:00Z'), msg('x', 'not a date')], [msg('a', '2026-10-07T10:00:00Z'), msg('b', '2026-10-07T11:00:00Z')]);
    assert.deepEqual(ids(merged), ['a', 'b', 'x']);
  });

  test('out-of-order arrival: a message committed later but older is placed by its time', () => {
    const merged = ts.mergeMessages([msg('a', '2026-10-07T10:00:00Z'), msg('c', '2026-10-07T10:00:09Z')], [msg('b', '2026-10-07T10:00:04Z')]);
    assert.deepEqual(ids(merged), ['a', 'b', 'c']);
  });

  test('unseenIds', () => {
    assert.deepEqual(ts.unseenIds(['a', 'b', 'a', 'c'], new Set(['b'])), ['a', 'c']);
  });
});

describe('createBatcher', () => {
  function fakeTimers() {
    let next = 1;
    const scheduled = new Map<number, () => void>();
    return {
      timers: {
        setTimeout: (fn: () => void) => {
          scheduled.set(next, fn);
          return next++;
        },
        clearTimeout: (h: number) => {
          scheduled.delete(h);
        },
      },
      fire: () => {
        for (const [k, fn] of [...scheduled]) {
          scheduled.delete(k);
          fn();
        }
      },
      pending: () => scheduled.size,
    };
  }

  test('ids within the window are fetched together, deduplicated, with ONE timer', () => {
    const t = fakeTimers();
    const flushed: string[][] = [];
    const b = ts.createBatcher((batch: string[]) => flushed.push(batch), 150, t.timers);
    b.add('a');
    b.add('b');
    b.add('a');
    assert.equal(t.pending(), 1);
    assert.deepEqual(flushed, []);
    t.fire();
    assert.deepEqual(flushed, [['a', 'b']]);
    b.add('c');
    t.fire();
    assert.deepEqual(flushed, [['a', 'b'], ['c']]);
  });

  test('more than 50 ids are flushed in chunks of at most 50 (the server cap)', () => {
    const t = fakeTimers();
    const flushed: string[][] = [];
    const b = ts.createBatcher((batch: string[]) => flushed.push(batch), 150, t.timers);
    for (let i = 0; i < 120; i++) b.add(`m${i}`);
    t.fire();
    assert.deepEqual(flushed.map((c) => c.length), [50, 50, 20]);
  });

  test('cancel drops what is pending (e.g. when the thread closes)', () => {
    const t = fakeTimers();
    const flushed: string[][] = [];
    const b = ts.createBatcher((batch: string[]) => flushed.push(batch), 150, t.timers);
    b.add('a');
    b.cancel();
    t.fire();
    assert.deepEqual(flushed, []);
    assert.equal(t.pending(), 0);
  });
});

describe('idsToMarkRead', () => {
  const list = [msg('a', 't', 'admin'), msg('b', 't', 'customer'), msg('c', 't', 'admin'), msg('temp-1', 't', 'admin'), msg('d', 't', undefined)];

  test('only displayed messages from the OTHER side, not already reported, never optimistic placeholders', () => {
    assert.deepEqual(ts.idsToMarkRead(list, 'customer', new Set()), ['a', 'c']);
    assert.deepEqual(ts.idsToMarkRead(list, 'customer', new Set(['a'])), ['c']);
    assert.deepEqual(ts.idsToMarkRead(list, 'admin', new Set()), ['b']);
  });

  test('a message not in the displayed list is never included (no cursor or time based marking)', () => {
    const shown = [msg('a', '2026-10-07T10:00:00Z', 'admin')];
    assert.deepEqual(ts.idsToMarkRead(shown, 'customer', new Set()), ['a']);
  });

  test('capped at 200 per call', () => {
    const many = Array.from({ length: 450 }, (_, i) => msg(`m${i}`, 't', 'admin'));
    assert.equal(ts.idsToMarkRead(many, 'customer', new Set()).length, 200);
  });
});

describe('createListeners', () => {
  test('fan-out, unsubscribe, and a throwing handler never blocks the others', () => {
    const l = ts.createListeners();
    const got: string[] = [];
    const off = l.subscribe((e: string) => got.push(`a:${e}`));
    l.subscribe(() => {
      throw new Error('boom');
    });
    l.subscribe((e: string) => got.push(`c:${e}`));
    const original = console.error;
    console.error = () => {};
    try {
      l.emit('x');
      off();
      l.emit('y');
    } finally {
      console.error = original;
    }
    assert.deepEqual(got, ['a:x', 'c:x', 'c:y']);
  });
});

describe('thread events and the bell cache', () => {
  test('planPushUpdate ignores message_created and thread_read (no list or count change, no refetch)', () => {
    const state = { list: { pages: [{ data: [], nextCursor: null }], pageParams: [undefined] }, listFetching: false, count: { count: 3, latestId: '9' }, countFetching: false };
    for (const event of [
      { type: 'message_created', customerId: 'c', messageId: 'm', senderType: 'admin' },
      { type: 'thread_read', customerId: 'c', side: 'customer' },
    ]) {
      assert.deepEqual(cache.planPushUpdate(state, event, (n: unknown) => n, 'now'), { invalidateList: false, invalidateCount: false });
    }
  });
});
