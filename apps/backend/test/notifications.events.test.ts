import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { CATALOG, CUSTOMER_STATUS_LABELS, NotificationType, excerpt } from '../src/modules/notifications/events';
import { recipientRoles } from '../src/modules/notifications/notification.service';
import { rolesWithModule } from '../src/middleware/permissions';
import { SHIPMENT_STATUSES } from '../src/modules/shipments/shipmentStatus';

const ctx = (count = 1) => ({ customer: { firstname: 'Ada', lastname: 'Obi' }, count });
const actor = { type: 'admin' as const, id: 'a1' };
const shipment = { id: 's1', orderId: 'CL1234-56-ab', customerId: 'c1' };

describe('catalog recipients', () => {
  test('admin recipients are always a subset of rolesWithModule(module)', () => {
    for (const [type, entry] of Object.entries(CATALOG) as [NotificationType, (typeof CATALOG)[NotificationType]][]) {
      if (!entry.module) continue;
      const allowed = rolesWithModule(entry.module);
      for (const role of recipientRoles(entry)) {
        assert.ok(allowed.includes(role), `${type}: ${role} cannot see module ${entry.module}`);
      }
    }
  });

  test('narrower roles as approved', () => {
    assert.deepEqual(recipientRoles(CATALOG['shipment.created']), ['super_admin', 'manager', 'logistics_officer']);
    assert.deepEqual(recipientRoles(CATALOG['shipment.cancelled_by_client']), ['super_admin', 'manager', 'logistics_officer']);
    assert.deepEqual(recipientRoles(CATALOG['message.received']).sort(), rolesWithModule('communications').sort());
  });
});

describe('excerpt (grapheme-safe)', () => {
  test('short text is unchanged apart from whitespace collapsing', () => {
    assert.equal(excerpt('  Hello\n\n  there  '), 'Hello there');
  });
  test('cuts at 120 graphemes and appends an ellipsis', () => {
    const long = 'a'.repeat(130);
    assert.equal(excerpt(long), 'a'.repeat(120) + '…');
  });
  test('never splits emoji, flags, skin tones or combining accents', () => {
    const family = '👨‍👩‍👧‍👦'; // 7 code points, 11 UTF-16 units, 1 grapheme
    const text = family.repeat(125);
    const out = excerpt(text);
    assert.equal(out, family.repeat(120) + '…');
    for (const unit of ['🇳🇬', '👍🏽', 'é']) {
      const r = excerpt(unit.repeat(121));
      assert.equal(r, unit.repeat(120) + '…', `unit ${unit}`);
    }
    assert.equal(excerpt(family + 'x'.repeat(119)), family + 'x'.repeat(119), 'exactly 120 graphemes kept whole');
  });
});

describe('customer status labels', () => {
  test('cover every shipment status', () => {
    for (const s of SHIPMENT_STATUSES) assert.ok(CUSTOMER_STATUS_LABELS[s], s);
  });

  test('match client/src/lib/shipmentStatus.ts when the client repo is checked out next to admin', (t) => {
    const clientFile = path.join(__dirname, '../../../../client/src/lib/shipmentStatus.ts');
    if (!fs.existsSync(clientFile)) {
      t.skip('client repo not present');
      return;
    }
    const src = fs.readFileSync(clientFile, 'utf8');
    for (const [status, label] of Object.entries(CUSTOMER_STATUS_LABELS)) {
      assert.match(src, new RegExp(`${status}: \\{ label: "${label}"`), `${status} → ${label}`);
    }
  });
});

describe('shipment.status_changed rules and copy', () => {
  const entry = CATALOG['shipment.status_changed'];
  const ev = (from: string, to: string, extra: Partial<{ isCorrection: boolean; isReopen: boolean; reason: string | null }> = {}) => ({
    type: 'shipment.status_changed' as const,
    actor,
    sourceId: 'x',
    shipment,
    from,
    to,
    reason: null,
    isCorrection: false,
    isReopen: false,
    ...extra,
  });

  test('skip whenever the customer-facing label does not change; corrections never notify', () => {
    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_STATUSES) {
        const sameLabel = CUSTOMER_STATUS_LABELS[from] === CUSTOMER_STATUS_LABELS[to];
        assert.equal(entry.shouldNotify!(ev(from, to)), !sameLabel, `${from}→${to}`);
        assert.equal(entry.shouldNotify!(ev(from, to, { isCorrection: true })), false, `${from}→${to} correction`);
      }
    }
    assert.equal(entry.shouldNotify!(ev('draft', 'pending')), false);
    assert.equal(entry.shouldNotify!(ev('cancelled', 'pending', { isReopen: true })), true, 'reopen notifies');
  });

  test('copy per destination status', () => {
    const o = shipment.orderId;
    const cases: Array<[string, string, string]> = [
      ['processing', `Shipment ${o} is being processed`, 'Shipment being prepared for dispatch.'],
      ['in_transit', `Shipment ${o} is in transit`, 'Shipment on its way to destination.'],
      ['clearance', `Shipment ${o} is in customs clearance`, 'Awaiting customs processing.'],
      ['delivered', `Shipment ${o} has been delivered`, 'Package delivered to recipient.'],
      ['pending', `Shipment ${o} is active again`, 'Your shipment has been reopened and is pending.'],
    ];
    for (const [to, title, body] of cases) {
      const r = entry.render(ev('x', to), ctx());
      assert.deepEqual([r.title, r.body], [title, body], to);
      assert.deepEqual(r.data, { orderId: o, from: 'x', to });
    }
    const cancelled = entry.render(ev('processing', 'cancelled', { reason: 'Goods were refused at origin' }), ctx());
    assert.deepEqual([cancelled.title, cancelled.body], [`Shipment ${o} was cancelled`, 'Reason: Goods were refused at origin']);
    assert.ok(!('reason' in cancelled.data), 'reason is not stored in data');
  });
});

describe('other copy', () => {
  test('shipment.created / created_for_customer / cancelled_by_client', () => {
    const created = CATALOG['shipment.created'].render(
      { type: 'shipment.created', actor: { type: 'customer', id: 'c1' }, sourceId: 's1', shipment: { ...shipment, shippingMode: 'air_freight' } },
      ctx()
    );
    assert.deepEqual([created.title, created.body], ['New shipment CL1234-56-ab', 'Ada Obi created a new Air freight shipment.']);

    const forCustomer = CATALOG['shipment.created_for_customer'].render(
      { type: 'shipment.created_for_customer', actor, sourceId: 's1', shipment: { ...shipment, status: 'draft' } },
      ctx()
    );
    assert.deepEqual([forCustomer.title, forCustomer.body], ['New shipment CL1234-56-ab', 'VHI created this shipment for you. Status: Pending.']);

    const cancelled = CATALOG['shipment.cancelled_by_client'].render(
      { type: 'shipment.cancelled_by_client', actor: { type: 'customer', id: 'c1' }, sourceId: 'a', shipment },
      ctx()
    );
    assert.deepEqual([cancelled.title, cancelled.body], ['Shipment CL1234-56-ab cancelled by customer', 'Ada Obi cancelled this pending shipment.']);
  });

  test('shipment.tracking_assigned shows the newly assigned number(s)', () => {
    const e = (awbNumber: string | null, bolNumber: string | null) =>
      ({ type: 'shipment.tracking_assigned' as const, actor, sourceId: 'a', shipment, awbNumber, bolNumber });
    const entry = CATALOG['shipment.tracking_assigned'];
    assert.equal(entry.render(e('176-12345675', null), ctx()).body, 'Tracking number: 176-12345675');
    assert.equal(entry.render(e(null, 'MSCU1234567'), ctx()).body, 'Tracking number: MSCU1234567');
    assert.equal(entry.render(e('176-1', 'MSCU1'), ctx()).body, 'Tracking numbers: 176-1, MSCU1');
    assert.equal(entry.render(e('176-1', null), ctx()).title, 'Tracking number added for CL1234-56-ab');
    assert.equal(entry.shouldNotify!(e(null, null)), false);
  });

  test('message.received titles (singular/plural, both directions) and excerpt body', () => {
    const entry = CATALOG['message.received'];
    const toAdmins = { type: 'message.received' as const, actor: { type: 'customer' as const, id: 'c1' }, sourceId: 'm', customerId: 'c1', direction: 'to_admins' as const, text: 'Where is my parcel?' };
    const toCustomer = { ...toAdmins, actor, direction: 'to_customer' as const, text: 'It ships today.' };
    assert.equal(entry.render(toAdmins, ctx(1)).title, 'New message from Ada Obi');
    assert.equal(entry.render(toAdmins, ctx(3)).title, '3 new messages from Ada Obi');
    assert.equal(entry.render(toCustomer, ctx(1)).title, 'New message from VHI Support');
    assert.equal(entry.render(toCustomer, ctx(2)).title, '2 new messages from VHI Support');
    assert.equal(entry.render(toCustomer, ctx(2)).body, 'It ships today.');
    assert.deepEqual(entry.render(toAdmins, ctx(3)).data, { customerId: 'c1', count: 3 });
  });
});
