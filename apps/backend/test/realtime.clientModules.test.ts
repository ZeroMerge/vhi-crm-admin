import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Pure front-end modules shared by both apps, tested here (the apps have no test runner).
const ADMIN_LIB = path.join(__dirname, '../../../app/src/lib');
const CLIENT_LIB = path.join(__dirname, '../../../../client/src/lib');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sse = require(path.join(ADMIN_LIB, 'sseParser.ts'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cache = require(path.join(ADMIN_LIB, 'notificationCache.ts'));

function parseAll(chunks: string[]) {
  let state = sse.initialSseState;
  const messages: any[] = [];
  for (const chunk of chunks) {
    const out = sse.parseSse(state, chunk);
    state = out.state;
    messages.push(...out.messages);
  }
  return { messages, state };
}

describe('sseParser (admin copy)', () => {
  const stream = 'event: ready\ndata: {}\n\n: ping\n\nevent: notification\nid: 42\ndata: {"a":1}\n\n';
  const expected = [
    { event: 'ready', data: '{}', lastEventId: '' },
    { event: 'notification', data: '{"a":1}', lastEventId: '42' },
  ];

  test('whole stream, comments ignored, id tracked', () => {
    assert.deepEqual(parseAll([stream]).messages, expected);
  });

  test('every possible chunk boundary gives the same result', () => {
    for (let i = 0; i <= stream.length; i++) {
      assert.deepEqual(parseAll([stream.slice(0, i), stream.slice(i)]).messages, expected, `split at ${i}`);
    }
    assert.deepEqual(parseAll(stream.split('')).messages, expected, 'one character per chunk');
  });

  test('CRLF and bare CR line endings, including a CRLF split across chunks', () => {
    const crlf = stream.replace(/\n/g, '\r\n');
    assert.deepEqual(parseAll([crlf]).messages, expected);
    for (let i = 0; i <= crlf.length; i++) {
      assert.deepEqual(parseAll([crlf.slice(0, i), crlf.slice(i)]).messages, expected, `CRLF split at ${i}`);
    }
    assert.deepEqual(parseAll([stream.replace(/\n/g, '\r')]).messages, expected);
  });

  test('multi-line data, default event name, field without space, field without colon, id with NUL ignored', () => {
    const { messages } = parseAll(['data: line one\ndata:line two\ndata\n\nid: ok\nid: bad\u0000id\ndata: x\nretry: 10\nfoo: bar\n\n']);
    assert.deepEqual(messages, [
      { event: 'message', data: 'line one\nline two\n', lastEventId: '' },
      { event: 'message', data: 'x', lastEventId: 'ok' },
    ]);
  });

  test('blank line with no data resets the event type without dispatching', () => {
    const { messages } = parseAll(['event: orphan\n\ndata: y\n\n']);
    assert.deepEqual(messages, [{ event: 'message', data: 'y', lastEventId: '' }]);
  });

  test('an incomplete trailing event stays buffered', () => {
    const { messages, state } = parseAll(['event: notification\ndata: {"partial"']);
    assert.equal(messages.length, 0);
    assert.equal(state.buffer, 'data: {"partial"');
  });
});

describe('notificationCache.planPushUpdate (admin copy)', () => {
  const item = (id: string, readAt: string | null = null) => ({ id, readAt, title: `t${id}` });
  const list = (...ids: string[]) => ({ pages: [{ data: ids.map((id) => item(id)), nextCursor: null }], pageParams: [undefined] });
  const pushed = (id: string) => ({ id, type: 'x', title: `t${id}`, body: '', entityType: 'shipment', entityId: 'e', createdAt: 'c' });
  const toItem = (n: any) => ({ id: n.id, readAt: null, title: n.title });
  const plan = (state: any, event: any) => cache.planPushUpdate(state, event, toItem, 'NOW');
  const idle = (l: any, count: any) => ({ list: l, listFetching: false, count, countFetching: false });

  test('new notification: prepended and the count incremented when its id is newer than latestId', () => {
    const p = plan(idle(list('5', '4'), { count: 2, latestId: '5' }), { type: 'notification', notification: pushed('6') });
    assert.deepEqual(p.list.pages[0].data.map((n: any) => n.id), ['6', '5', '4']);
    assert.deepEqual(p.count, { count: 3, latestId: '6' });
    assert.equal(p.invalidateList, false);
    assert.equal(p.invalidateCount, false);
  });

  test('already in the list (REST got it first): no duplicate, count refetched rather than double-counted', () => {
    const p = plan(idle(list('6', '5'), { count: 2, latestId: '6' }), { type: 'notification', notification: pushed('6') });
    assert.equal(p.list, undefined);
    assert.equal(p.count, undefined);
    assert.equal(p.invalidateCount, true);
  });

  test('out-of-order commit (id below latestId) is ambiguous: count refetched', () => {
    const p = plan(idle(list('9'), { count: 1, latestId: '9' }), { type: 'notification', notification: pushed('8') });
    assert.deepEqual(p.list.pages[0].data.map((n: any) => n.id), ['8', '9'], 'list still deduped and patched');
    assert.equal(p.invalidateCount, true);
  });

  test('(b) a push during an in-flight refetch is not lost: the query is invalidated instead of patched', () => {
    const p = plan({ list: list('1'), listFetching: true, count: { count: 1, latestId: '1' }, countFetching: true },
      { type: 'notification', notification: pushed('2') });
    assert.equal(p.list, undefined);
    assert.equal(p.count, undefined);
    assert.equal(p.invalidateList, true);
    assert.equal(p.invalidateCount, true);
  });

  test('nothing loaded yet: nothing to patch or invalidate', () => {
    const p = plan(idle(undefined, undefined), { type: 'notification', notification: pushed('1') });
    assert.deepEqual(p, { invalidateList: false, invalidateCount: false });
  });

  test('read / read_all mark items read; replaced removes the old rows; the count is refetched', () => {
    const base = idle(list('3', '2', '1'), { count: 3, latestId: '3' });
    const r = plan(base, { type: 'read', ids: ['2'] });
    assert.deepEqual(r.list.pages[0].data.map((n: any) => n.readAt), [null, 'NOW', null]);
    assert.equal(r.invalidateCount, true);
    const all = plan(base, { type: 'read_all', ids: ['1', '2', '3'] });
    assert.ok(all.list.pages[0].data.every((n: any) => n.readAt === 'NOW'));
    const rep = plan(base, { type: 'replaced', removedIds: ['2'], addedIds: ['4'] });
    assert.deepEqual(rep.list.pages[0].data.map((n: any) => n.id), ['3', '1']);
    assert.equal(rep.invalidateCount, true);
  });

  test('already-read items keep their original readAt', () => {
    const l = { pages: [{ data: [item('1', 'EARLIER')], nextCursor: null }], pageParams: [undefined] };
    const p = plan(idle(l, undefined), { type: 'read', ids: ['1'] });
    assert.equal(p.list.pages[0].data[0].readAt, 'EARLIER');
  });
});

describe('client copies are byte-identical to the admin copies', () => {
  for (const file of ['sseParser.ts', 'notificationCache.ts', 'notificationStream.ts', 'threadSync.ts']) {
    test(file, (t) => {
      const adminFile = path.join(ADMIN_LIB, file);
      const clientFile = path.join(CLIENT_LIB, file);
      if (!fs.existsSync(adminFile) || !fs.existsSync(clientFile)) {
        t.skip('not present in both apps yet');
        return;
      }
      const norm = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      assert.equal(norm(clientFile), norm(adminFile));
    });
  }
});
