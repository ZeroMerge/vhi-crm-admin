// Notification event catalog (Phase 1, in-app only).
// Rendering happens at emit time: the stored title/body are exactly what the recipient sees, so copy must
// only contain things the recipient can already see in their own UI.

export type ActorType = 'admin' | 'customer' | 'system';

export interface Actor {
  type: ActorType;
  id: string | null;
}

interface ShipmentRef {
  id: string;
  orderId: string;
  customerId: string;
}

interface Base {
  actor: Actor;
  // Id of the row that records this event (audit_logs / communications / shipments); dedupe_key = `${type}:${sourceId}`.
  sourceId: string;
}

export type NotificationEvent =
  | (Base & { type: 'shipment.created'; shipment: ShipmentRef & { shippingMode: string } })
  | (Base & { type: 'shipment.created_for_customer'; shipment: ShipmentRef & { status: string } })
  | (Base & { type: 'shipment.cancelled_by_client'; shipment: ShipmentRef })
  | (Base & {
      type: 'shipment.status_changed';
      shipment: ShipmentRef;
      from: string;
      to: string;
      reason: string | null;
      isCorrection: boolean;
      isReopen: boolean;
    })
  | (Base & { type: 'shipment.tracking_assigned'; shipment: ShipmentRef; awbNumber: string | null; bolNumber: string | null })
  | (Base & { type: 'message.received'; customerId: string; direction: 'to_admins' | 'to_customer'; text: string; subject?: string })
  // ---- Phase 4: scheduled jobs and email bounces (actor: system). Dates arrive already formatted in APP_TIMEZONE.
  | (Base & {
      type: 'shipment.stuck';
      shipment: ShipmentRef;
      status: string;
      days: number;
      thresholdHours: number;
      /** Formatted date of the last status change. */
      since: string;
      /** 0 = first alert of this stuck period, n = n-th reminder. */
      reminder: number;
    })
  | (Base & {
      type: 'invoice.overdue';
      invoice: { id: string; number: string; customerId: string; amount: string; currency: string; dueDate: string };
      daysOverdue: number;
      reminder: number;
    })
  | (Base & { type: 'customer.registered'; customer: { id: string; email: string } })
  | (Base & { type: 'email.bounced'; customerId: string; email: string });

export type NotificationType = NotificationEvent['type'];
type EventOf<T extends NotificationType> = Extract<NotificationEvent, { type: T }>;

export interface RenderContext {
  customer: { firstname: string; lastname: string };
  // message.received grouping: number of unread messages this notification now represents (1 = no grouping).
  count: number;
}

export interface Rendered {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface CatalogEntry<T extends NotificationType> {
  audience: (e: EventOf<T>) => 'customer' | 'admins';
  // Admin visibility module (stored on admin rows; the feed filters by it).
  module?: string;
  // Narrower admin recipient roles; must be a subset of rolesWithModule(module) (unit-tested).
  roles?: string[];
  entity: (e: EventOf<T>) => { type: 'shipment' | 'customer_thread' | 'invoice' | 'customer'; id: string };
  // Customer-facing recipient (owner of the entity).
  customerId: (e: EventOf<T>) => string;
  shouldNotify?: (e: EventOf<T>) => boolean;
  // Replace the recipient's unread notification for the same entity instead of adding another.
  groupUnread?: boolean;
  render: (e: EventOf<T>, ctx: RenderContext) => Rendered;
}

// Customer-facing status labels. MUST stay in sync with client/src/lib/shipmentStatus.ts (STATUS_DISPLAY).
export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  draft: 'Pending',
  pending: 'Pending',
  processing: 'Processing',
  in_transit: 'In transit',
  clearance: 'Customs clearance',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const customerStatusLabel = (status: string) => CUSTOMER_STATUS_LABELS[status] ?? status;

const humanize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ').toLowerCase();

const fullName = (c: RenderContext['customer']) => `${c.firstname} ${c.lastname}`.trim();

/** "1500.5" → "1,500.50" (string arithmetic only: DECIMAL(15,2) values never pass through a float). */
export function formatAmount(amount: string): string {
  const [whole, fraction = ''] = String(amount).trim().split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/** "48 hours" → "2 days"; thresholds that aren't whole days stay in hours. */
export const durationLabel = (hours: number) =>
  hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? '' : 's'}` : `${hours} hour${hours === 1 ? '' : 's'}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Excerpt by grapheme cluster (never splits emoji or combined characters), whitespace collapsed.
export function excerpt(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(collapsed), (s) => s.segment);
  return graphemes.length <= max ? collapsed : graphemes.slice(0, max).join('').trimEnd() + '…';
}

// Status-change copy for the customer, by destination status. Bodies reuse the client tracking timeline wording.
const STATUS_COPY: Record<string, (orderId: string, e: EventOf<'shipment.status_changed'>) => { title: string; body: string }> = {
  processing: (o) => ({ title: `Shipment ${o} is being processed`, body: 'Shipment being prepared for dispatch.' }),
  in_transit: (o) => ({ title: `Shipment ${o} is in transit`, body: 'Shipment on its way to destination.' }),
  clearance: (o) => ({ title: `Shipment ${o} is in customs clearance`, body: 'Awaiting customs processing.' }),
  delivered: (o) => ({ title: `Shipment ${o} has been delivered`, body: 'Package delivered to recipient.' }),
  cancelled: (o, e) => ({
    title: `Shipment ${o} was cancelled`,
    body: e.reason ? `Reason: ${e.reason}` : 'This shipment was cancelled and will not be processed further.',
  }),
  pending: (o) => ({ title: `Shipment ${o} is active again`, body: 'Your shipment has been reopened and is pending.' }),
};

const shipmentEntity = (e: { shipment: ShipmentRef }) => ({ type: 'shipment' as const, id: e.shipment.id });
const shipmentOwner = (e: { shipment: ShipmentRef }) => e.shipment.customerId;
export const SHIPMENT_OPERATIONS_ROLES = ['super_admin', 'manager', 'logistics_officer'];
/** Who hears about new customers (in-app and the registration digest). */
export const CUSTOMER_GROWTH_ROLES = ['super_admin', 'manager', 'crm_officer'];
/** Who can fix a customer's email address. */
export const CUSTOMER_CONTACT_ROLES = ['super_admin', 'manager', 'crm_officer', 'support_staff'];

export const CATALOG: { [T in NotificationType]: CatalogEntry<T> } = {
  'shipment.created': {
    audience: () => 'admins',
    module: 'shipments',
    roles: SHIPMENT_OPERATIONS_ROLES,
    entity: shipmentEntity,
    customerId: shipmentOwner,
    render: (e, ctx) => ({
      title: `New shipment ${e.shipment.orderId}`,
      body: `${fullName(ctx.customer)} created a new ${humanize(e.shipment.shippingMode)} shipment.`,
      data: { orderId: e.shipment.orderId },
    }),
  },

  'shipment.created_for_customer': {
    audience: () => 'customer',
    entity: shipmentEntity,
    customerId: shipmentOwner,
    render: (e) => ({
      title: `New shipment ${e.shipment.orderId}`,
      body: `VHI created this shipment for you. Status: ${customerStatusLabel(e.shipment.status)}.`,
      data: { orderId: e.shipment.orderId },
    }),
  },

  'shipment.cancelled_by_client': {
    audience: () => 'admins',
    module: 'shipments',
    roles: SHIPMENT_OPERATIONS_ROLES,
    entity: shipmentEntity,
    customerId: shipmentOwner,
    render: (e, ctx) => ({
      title: `Shipment ${e.shipment.orderId} cancelled by customer`,
      body: `${fullName(ctx.customer)} cancelled this pending shipment.`,
      data: { orderId: e.shipment.orderId },
    }),
  },

  'shipment.status_changed': {
    audience: () => 'customer',
    entity: shipmentEntity,
    customerId: shipmentOwner,
    // Corrections never notify the customer; neither does a change the customer cannot see (same label, e.g. draft→pending).
    shouldNotify: (e) => !e.isCorrection && customerStatusLabel(e.from) !== customerStatusLabel(e.to),
    render: (e) => {
      const copy = STATUS_COPY[e.to]?.(e.shipment.orderId, e) ?? {
        title: `Shipment ${e.shipment.orderId} is ${customerStatusLabel(e.to).toLowerCase()}`,
        body: '',
      };
      return { ...copy, data: { orderId: e.shipment.orderId, from: e.from, to: e.to } };
    },
  },

  'shipment.tracking_assigned': {
    audience: () => 'customer',
    entity: shipmentEntity,
    customerId: shipmentOwner,
    shouldNotify: (e) => Boolean(e.awbNumber || e.bolNumber),
    render: (e) => {
      const numbers = [e.awbNumber, e.bolNumber].filter((n): n is string => Boolean(n));
      return {
        title: `Tracking number added for ${e.shipment.orderId}`,
        body: numbers.length === 1 ? `Tracking number: ${numbers[0]}` : `Tracking numbers: ${numbers.join(', ')}`,
        data: { orderId: e.shipment.orderId },
      };
    },
  },

  'message.received': {
    audience: (e) => (e.direction === 'to_admins' ? 'admins' : 'customer'),
    module: 'communications',
    entity: (e) => ({ type: 'customer_thread', id: e.customerId }),
    customerId: (e) => e.customerId,
    groupUnread: true,
    render: (e, ctx) => {
      const from = e.direction === 'to_admins' ? fullName(ctx.customer) : 'VHI Support';
      return {
        title: ctx.count === 1 ? `New message from ${from}` : `${ctx.count} new messages from ${from}`,
        body: excerpt(e.text),
        data: { customerId: e.customerId, count: ctx.count },
      };
    },
  },

  'shipment.stuck': {
    audience: () => 'admins',
    module: 'shipments',
    roles: SHIPMENT_OPERATIONS_ROLES,
    entity: shipmentEntity,
    customerId: shipmentOwner,
    render: (e) => {
      const stuck = `Shipment ${e.shipment.orderId} stuck in ${humanize(e.status)} for ${plural(e.days, 'day')}`;
      return {
        title: e.reminder > 0 ? `Still stuck: ${stuck}` : stuck,
        body: `No status change since ${e.since}. Threshold: ${durationLabel(e.thresholdHours)}.`,
        data: { orderId: e.shipment.orderId, status: e.status, days: e.days, reminder: e.reminder },
      };
    },
  },

  'invoice.overdue': {
    audience: () => 'admins',
    module: 'invoices',
    entity: (e) => ({ type: 'invoice', id: e.invoice.id }),
    customerId: (e) => e.invoice.customerId,
    render: (e, ctx) => ({
      title:
        e.reminder > 0
          ? `Invoice ${e.invoice.number} is still overdue (${plural(e.daysOverdue, 'day')})`
          : `Invoice ${e.invoice.number} is overdue`,
      body: `${fullName(ctx.customer) || 'Customer'}: ${formatAmount(e.invoice.amount)} ${e.invoice.currency}, due ${e.invoice.dueDate}.`,
      data: { invoiceNumber: e.invoice.number, daysOverdue: e.daysOverdue, reminder: e.reminder },
    }),
  },

  'customer.registered': {
    audience: () => 'admins',
    module: 'customers',
    roles: CUSTOMER_GROWTH_ROLES,
    entity: (e) => ({ type: 'customer', id: e.customer.id }),
    customerId: (e) => e.customer.id,
    render: (e, ctx) => ({
      title: `New customer ${fullName(ctx.customer) || e.customer.email}`,
      body: `${e.customer.email} verified their account.`,
      data: {},
    }),
  },

  'email.bounced': {
    audience: () => 'admins',
    module: 'customers',
    roles: CUSTOMER_CONTACT_ROLES,
    entity: (e) => ({ type: 'customer', id: e.customerId }),
    customerId: (e) => e.customerId,
    render: (e, ctx) => ({
      title: `Email to ${fullName(ctx.customer) || e.email} bounced`,
      body: `${e.email} rejected our email. Update the address so they get account and shipment emails.`,
      data: {},
    }),
  },
};
