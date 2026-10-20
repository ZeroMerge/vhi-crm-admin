import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// The client app has no test runner, so its pure link helper is loaded and tested here (like help.test.ts).
const CLIENT = path.join(__dirname, '../../../../client/src');
const load = (file: string): any => require(path.join(CLIENT, file)); // eslint-disable-line @typescript-eslint/no-require-imports

const { detailsHref } = load('lib/shipmentLinks.ts');

describe('detailsHref', () => {
  test('points at Tracking with the order selected', () => {
    assert.equal(detailsHref('A-1895-67-fw'), '/dashboard/tracking?order=A-1895-67-fw');
  });

  test('encodes a staff-created "#" order ID so it is not read as a fragment', () => {
    const href = detailsHref('#VHI-0042');
    assert.equal(href, '/dashboard/tracking?order=%23VHI-0042');
    assert.equal(new URL(href, 'http://x').searchParams.get('order'), '#VHI-0042');
    assert.equal(new URL(href, 'http://x').hash, '');
  });

  test('encodes characters that would add parameters or path segments', () => {
    const id = 'a&b=c/d e';
    assert.equal(new URL(detailsHref(id), 'http://x').searchParams.get('order'), id);
    assert.equal(new URL(detailsHref(id), 'http://x').pathname, '/dashboard/tracking');
  });
});

describe('notification links reuse it', () => {
  test('a shipment notification goes to the same URL as the row link', () => {
    const src = fs.readFileSync(path.join(CLIENT, 'lib/notificationLinks.ts'), 'utf8');
    assert.match(src, /detailsHref\(orderId\)/);
    assert.doesNotMatch(src, /encodeURIComponent/);
  });
});
