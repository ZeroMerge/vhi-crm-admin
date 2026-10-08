// The ONLY place shipment status transitions are defined and checked.
// Values mirror shipment_status_enum (migration 003_create_shipments.sql).

export const SHIPMENT_STATUSES = ['draft', 'pending', 'processing', 'in_transit', 'clearance', 'delivered', 'cancelled'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export type ActorType = 'admin' | 'customer';
export type TransitionKind = 'forward' | 'cancel' | 'correction' | 'reopen';

export interface TransitionResult {
  from: string;
  to: ShipmentStatus;
  kind: TransitionKind;
  // Corrections fix a mistake and must not notify customers.
  isCorrection: boolean;
  // Leaves a terminal status (delivered/cancelled).
  isReopen: boolean;
}

export interface AllowedTransition {
  to: ShipmentStatus;
  kind: TransitionKind;
  isCorrection: boolean;
  isReopen: boolean;
  requiresReason: boolean;
}

export class ShipmentTransitionError extends Error {
  constructor(public status: 400 | 403 | 409, public code: string, message: string) {
    super(message);
    this.name = 'ShipmentTransitionError';
  }
}

interface Rule {
  from: ShipmentStatus | '*';
  to: ShipmentStatus;
  kind: TransitionKind;
  actor: ActorType;
  // Admin roles allowed; undefined = any admin that may write.
  roles?: string[];
  requiresReason: boolean;
}

const SENIOR_ROLES = ['super_admin', 'manager'];

// support_staff is read-only on the server (middleware/adminMiddleware.ts), so it is offered no transitions.
const READ_ONLY_ROLES = ['support_staff'];

const forward = (from: ShipmentStatus, to: ShipmentStatus): Rule => ({ from, to, kind: 'forward', actor: 'admin', requiresReason: false });
const correction = (from: ShipmentStatus, to: ShipmentStatus): Rule => ({ from, to, kind: 'correction', actor: 'admin', requiresReason: true });
const adminCancel = (from: ShipmentStatus | '*', roles?: string[]): Rule => ({ from, to: 'cancelled', kind: 'cancel', actor: 'admin', roles, requiresReason: true });
const reopen = (from: ShipmentStatus, to: ShipmentStatus): Rule => ({ from, to, kind: 'reopen', actor: 'admin', roles: SENIOR_ROLES, requiresReason: true });

const RULES: Rule[] = [
  forward('draft', 'pending'),
  forward('pending', 'processing'),
  forward('processing', 'in_transit'),
  forward('in_transit', 'clearance'),
  forward('clearance', 'delivered'),
  forward('in_transit', 'delivered'),

  // Every admin cancel needs a reason (it will be shown to the customer).
  adminCancel('draft'),
  adminCancel('pending'),
  adminCancel('processing'),
  adminCancel('in_transit', SENIOR_ROLES),
  adminCancel('clearance', SENIOR_ROLES),
  { from: 'pending', to: 'cancelled', kind: 'cancel', actor: 'customer', requiresReason: false },

  // One step back along the forward path.
  correction('processing', 'pending'),
  correction('in_transit', 'processing'),
  correction('clearance', 'in_transit'),

  // Leaving a terminal status.
  reopen('delivered', 'clearance'),
  reopen('delivered', 'in_transit'),
  reopen('cancelled', 'pending'),

  // A stored status outside the enum cannot happen today, but must never leave a row stuck.
  adminCancel('*', SENIOR_ROLES),
];

// delivered → x is a correction (no customer notification); cancelled → pending is a real reopen (notifies).
const isCorrectionRule = (rule: Rule) => rule.kind === 'correction' || (rule.kind === 'reopen' && rule.from === 'delivered');

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return typeof value === 'string' && (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

function rulesFrom(from: string): Rule[] {
  return isShipmentStatus(from) ? RULES.filter((r) => r.from === from) : RULES.filter((r) => r.from === '*');
}

function actorMayUse(rule: Rule, actorType: ActorType, actorRole?: string | null): boolean {
  if (rule.actor !== actorType) return false;
  if (actorType === 'customer') return true;
  if (!actorRole || READ_ONLY_ROLES.includes(actorRole)) return false;
  return !rule.roles || rule.roles.includes(actorRole);
}

export function assertValidStatus(value: unknown): ShipmentStatus {
  if (!isShipmentStatus(value)) {
    throw new ShipmentTransitionError(400, 'INVALID_STATUS', `Invalid shipment status. Allowed: ${SHIPMENT_STATUSES.join(', ')}`);
  }
  return value;
}

export function assertTransition(params: {
  from: string;
  to: unknown;
  actorType: ActorType;
  actorRole?: string | null;
  reason?: string | null;
}): TransitionResult {
  const { from, actorType, actorRole } = params;
  const to = assertValidStatus(params.to);

  if (from === to) {
    throw new ShipmentTransitionError(400, 'NO_OP', `Shipment is already ${to}`);
  }

  const candidates = rulesFrom(from).filter((r) => r.to === to);
  if (candidates.length === 0) {
    throw new ShipmentTransitionError(400, 'TRANSITION_NOT_ALLOWED', `Cannot change shipment status from ${from} to ${to}`);
  }

  const rule = candidates.find((r) => actorMayUse(r, actorType, actorRole));
  if (!rule) {
    throw new ShipmentTransitionError(403, 'FORBIDDEN', `You are not allowed to change shipment status from ${from} to ${to}`);
  }

  if (rule.requiresReason && !(typeof params.reason === 'string' && params.reason.trim())) {
    throw new ShipmentTransitionError(400, 'REASON_REQUIRED', `A reason is required to change shipment status from ${from} to ${to}`);
  }

  return { from, to, kind: rule.kind, isCorrection: isCorrectionRule(rule), isReopen: rule.kind === 'reopen' };
}

export function getAllowedTransitions(from: string, actorType: ActorType, actorRole?: string | null): AllowedTransition[] {
  return rulesFrom(from)
    .filter((r) => actorMayUse(r, actorType, actorRole))
    .sort((a, b) => SHIPMENT_STATUSES.indexOf(a.to) - SHIPMENT_STATUSES.indexOf(b.to))
    .map((r) => ({
      to: r.to,
      kind: r.kind,
      isCorrection: isCorrectionRule(r),
      isReopen: r.kind === 'reopen',
      requiresReason: r.requiresReason,
    }));
}

const INITIAL_STATUSES: Record<ActorType, ShipmentStatus[]> = {
  admin: ['draft', 'pending', 'processing', 'in_transit', 'clearance'],
  customer: ['pending'],
};

export function assertInitialStatus(value: unknown, actorType: ActorType): ShipmentStatus {
  const status = assertValidStatus(value);
  if (!INITIAL_STATUSES[actorType].includes(status)) {
    throw new ShipmentTransitionError(
      400,
      'INITIAL_STATUS_NOT_ALLOWED',
      `A new shipment cannot start as ${status}. Allowed: ${INITIAL_STATUSES[actorType].join(', ')}`
    );
  }
  return status;
}

export function conflictError(message = 'This shipment was changed by someone else. Reload and try again.') {
  return new ShipmentTransitionError(409, 'CONFLICT', message);
}
