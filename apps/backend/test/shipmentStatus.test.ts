import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIPMENT_STATUSES,
  ShipmentTransitionError,
  assertInitialStatus,
  assertTransition,
  getAllowedTransitions,
} from '../src/modules/shipments/shipmentStatus';

// Independent copy of the approved rules (Phase 0, Item 3), written as data so the module is checked
// against the spec rather than against itself.
type Who = 'anyAdmin' | 'senior' | 'customer';
interface Expect { who: Who; reason: boolean; isCorrection: boolean; isReopen: boolean }
const f = (who: Who, reason = false, isCorrection = false, isReopen = false): Expect => ({ who, reason, isCorrection, isReopen });

const EXPECTED: Record<string, Expect[]> = {
  'draft>pending': [f('anyAdmin')],
  'pending>processing': [f('anyAdmin')],
  'processing>in_transit': [f('anyAdmin')],
  'in_transit>clearance': [f('anyAdmin')],
  'clearance>delivered': [f('anyAdmin')],
  'in_transit>delivered': [f('anyAdmin')],
  'draft>cancelled': [f('anyAdmin', true)],
  'pending>cancelled': [f('anyAdmin', true), f('customer')],
  'processing>cancelled': [f('anyAdmin', true)],
  'in_transit>cancelled': [f('senior', true)],
  'clearance>cancelled': [f('senior', true)],
  'processing>pending': [f('anyAdmin', true, true)],
  'in_transit>processing': [f('anyAdmin', true, true)],
  'clearance>in_transit': [f('anyAdmin', true, true)],
  'delivered>clearance': [f('senior', true, true, true)],
  'delivered>in_transit': [f('senior', true, true, true)],
  'cancelled>pending': [f('senior', true, false, true)],
  // stored value outside the enum (cannot happen today): only a senior cancel
  'legacy_status>cancelled': [f('senior', true)],
};

const ADMIN_ROLES = ['super_admin', 'manager', 'logistics_officer', 'finance_officer', 'crm_officer', 'support_staff'];
const ACTORS: Array<{ actorType: 'admin' | 'customer'; actorRole: string | null }> = [
  ...ADMIN_ROLES.map((r) => ({ actorType: 'admin' as const, actorRole: r })),
  { actorType: 'customer', actorRole: null },
];
const FROMS = [...SHIPMENT_STATUSES, 'legacy_status'];
const TOS = [...SHIPMENT_STATUSES, 'shipped'];

function permits(e: Expect, actorType: string, actorRole: string | null) {
  if (e.who === 'customer') return actorType === 'customer';
  if (actorType !== 'admin' || actorRole === 'support_staff') return false;
  return e.who === 'anyAdmin' || ['super_admin', 'manager'].includes(actorRole!);
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    assert.ok(err instanceof ShipmentTransitionError, `unexpected error type: ${err}`);
    return `${err.status}:${err.code}`;
  }
}

describe('assertTransition: every from × to × actor', () => {
  for (const from of FROMS) {
    for (const to of TOS) {
      for (const { actorType, actorRole } of ACTORS) {
        const label = `${from} → ${to} as ${actorRole ?? 'customer'}`;
        test(label, () => {
          const call = (reason?: string) => () => assertTransition({ from, to, actorType, actorRole, reason });

          if (!(SHIPMENT_STATUSES as readonly string[]).includes(to)) {
            assert.equal(codeOf(call('r')), '400:INVALID_STATUS');
            return;
          }
          if (from === to) {
            assert.equal(codeOf(call('r')), '400:NO_OP');
            return;
          }
          const options = EXPECTED[`${from}>${to}`];
          if (!options) {
            assert.equal(codeOf(call('r')), '400:TRANSITION_NOT_ALLOWED');
            return;
          }
          const match = options.find((e) => permits(e, actorType, actorRole));
          if (!match) {
            assert.equal(codeOf(call('r')), '403:FORBIDDEN');
            return;
          }
          if (match.reason) {
            assert.equal(codeOf(call()), '400:REASON_REQUIRED', 'missing reason');
            assert.equal(codeOf(call('   ')), '400:REASON_REQUIRED', 'blank reason');
          }
          const result = assertTransition({ from, to, actorType, actorRole, reason: match.reason ? 'because' : undefined });
          assert.equal(result.from, from);
          assert.equal(result.to, to);
          assert.equal(result.isCorrection, match.isCorrection, 'isCorrection');
          assert.equal(result.isReopen, match.isReopen, 'isReopen');
        });
      }
    }
  }
});

describe('getAllowedTransitions matches assertTransition', () => {
  for (const from of FROMS) {
    for (const { actorType, actorRole } of ACTORS) {
      test(`${from} as ${actorRole ?? 'customer'}`, () => {
        const allowed = getAllowedTransitions(from, actorType, actorRole);
        const expectedTos = SHIPMENT_STATUSES.filter((to) =>
          (EXPECTED[`${from}>${to}`] ?? []).some((e) => permits(e, actorType, actorRole))
        );
        assert.deepEqual(allowed.map((a) => a.to), expectedTos);
        for (const a of allowed) {
          const e = EXPECTED[`${from}>${a.to}`].find((x) => permits(x, actorType, actorRole))!;
          assert.equal(a.requiresReason, e.reason, `${a.to} requiresReason`);
          assert.equal(a.isCorrection, e.isCorrection, `${a.to} isCorrection`);
          assert.equal(a.isReopen, e.isReopen, `${a.to} isReopen`);
        }
      });
    }
  }

  test('no status leaves a senior admin stuck; support_staff is offered nothing', () => {
    for (const from of FROMS) {
      assert.ok(getAllowedTransitions(from, 'admin', 'manager').length > 0, `manager stuck at ${from}`);
      assert.deepEqual(getAllowedTransitions(from, 'admin', 'support_staff'), []);
    }
  });

  test('every admin cancel requires a reason; the customer cancel does not', () => {
    for (const from of FROMS) {
      for (const role of ADMIN_ROLES) {
        for (const t of getAllowedTransitions(from, 'admin', role).filter((x) => x.to === 'cancelled')) {
          assert.equal(t.requiresReason, true, `${from} cancel by ${role}`);
        }
      }
    }
    assert.deepEqual(getAllowedTransitions('pending', 'customer'), [
      { to: 'cancelled', kind: 'cancel', isCorrection: false, isReopen: false, requiresReason: false },
    ]);
  });
});

describe('assertInitialStatus', () => {
  test('admin may start in draft, pending, processing, in_transit or clearance', () => {
    for (const s of SHIPMENT_STATUSES) {
      const ok = ['draft', 'pending', 'processing', 'in_transit', 'clearance'].includes(s);
      assert.equal(codeOf(() => assertInitialStatus(s, 'admin')), ok ? null : '400:INITIAL_STATUS_NOT_ALLOWED', s);
    }
  });

  test('customer always starts pending; invalid values are 400', () => {
    assert.equal(assertInitialStatus('pending', 'customer'), 'pending');
    assert.equal(codeOf(() => assertInitialStatus('processing', 'customer')), '400:INITIAL_STATUS_NOT_ALLOWED');
    assert.equal(codeOf(() => assertInitialStatus('shipped', 'admin')), '400:INVALID_STATUS');
    assert.equal(codeOf(() => assertInitialStatus(undefined, 'admin')), '400:INVALID_STATUS');
    assert.equal(codeOf(() => assertInitialStatus(42, 'admin')), '400:INVALID_STATUS');
  });
});
