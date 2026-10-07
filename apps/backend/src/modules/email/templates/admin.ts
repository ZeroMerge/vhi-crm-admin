// Staff-facing emails (individual admins and the support inbox). Copy approved in docs/PLAN-P3-EMAIL.md §4.
import { oneLine } from './html';
import { formatSentAt, MessageEntry, selectMessages } from './messages';
import { formatTime } from '../../../utils/appTime';
import type { EmailDoc } from './layout';
import type { TemplateContext } from './context';

// Same labels as the admin Topbar (app/src/components/layout/Topbar.tsx).
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  manager: 'Manager',
  logistics_officer: 'Logistics Officer',
  finance_officer: 'Finance Officer',
  crm_officer: 'CRM Officer',
  support_staff: 'Support Staff',
};
const roleLabel = (role: string) => ROLE_LABELS[role] ?? oneLine(role);
const modeLabel = (mode: string) => {
  const words = oneLine(mode).replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const greeting = (name: string) => (oneLine(name) ? `Hi ${oneLine(name)},` : 'Hello,');

export interface AdminShipmentCreatedParams {
  adminName: string;
  customerName: string;
  orderId: string;
  shipmentId: string;
  shippingMode: string;
}
export function adminShipmentCreated(p: AdminShipmentCreatedParams, ctx: TemplateContext): EmailDoc {
  const orderId = oneLine(p.orderId);
  const customer = oneLine(p.customerName) || 'A customer';
  return {
    subject: `New shipment ${orderId} from ${customer}`,
    preheader: `${modeLabel(p.shippingMode)} shipment created in the customer portal.`,
    greeting: greeting(p.adminName),
    blocks: [
      { kind: 'p', text: `${customer} created shipment ${orderId} (${modeLabel(p.shippingMode)}) in the customer portal.` },
      { kind: 'button', label: 'Open shipment', url: ctx.links.adminShipment(p.shipmentId) },
    ],
    footer: { kind: 'staff', settingsUrl: ctx.links.adminNotificationSettings() },
  };
}

export interface AdminInviteParams {
  adminName: string;
  inviterName: string;
  roles: string[];
  /** Single-use invitation token; wiped from the row once the email is sent. */
  token: string;
}
/** A6: service email (no opt-out). The link is printed too, for mail clients that break buttons. */
export function adminInvite(p: AdminInviteParams, ctx: TemplateContext): EmailDoc {
  const roles = p.roles.map(roleLabel).join(', ') || 'a team member';
  const inviter = oneLine(p.inviterName);
  return {
    subject: "You're invited to VHI CRM",
    preheader: `${inviter || 'A super admin'} invited you to VHI CRM as ${roles}.`,
    greeting: greeting(p.adminName),
    blocks: [
      { kind: 'p', text: `${inviter || 'A super admin'} has invited you to VHI CRM as ${roles}.` },
      { kind: 'p', text: 'Set a password to get started. This link expires in 72 hours.' },
      { kind: 'button', label: 'Set your password', url: ctx.links.adminAcceptInvite(p.token), showUrl: true },
      { kind: 'p', text: "If you weren't expecting this invitation, you can ignore this email." },
    ],
    footer: { kind: 'staff' },
  };
}

export interface AdminRolesChangedParams { adminName: string; roles: string[] }
export function adminRolesChanged(p: AdminRolesChangedParams, ctx: TemplateContext): EmailDoc {
  const roles = p.roles.map(roleLabel).join(', ') || 'none';
  return {
    subject: 'Your VHI CRM access was updated',
    preheader: `Your roles are now: ${roles}.`,
    greeting: greeting(p.adminName),
    blocks: [
      { kind: 'p', text: `Your roles in VHI CRM are now: ${roles}.` },
      { kind: 'p', text: 'Sign in again to use your updated access.' },
      { kind: 'button', label: 'Sign in', url: ctx.links.adminLogin() },
      { kind: 'p', text: "If you weren't expecting this, contact your super admin." },
    ],
    footer: { kind: 'staff' },
  };
}

export interface AdminDeactivatedParams { adminName: string }
export function adminDeactivated(p: AdminDeactivatedParams): EmailDoc {
  return {
    subject: 'Your VHI CRM account has been deactivated',
    preheader: 'You can no longer sign in to VHI CRM.',
    greeting: greeting(p.adminName),
    blocks: [
      { kind: 'p', text: 'Your VHI CRM account has been deactivated, so you can no longer sign in.' },
      { kind: 'p', text: 'If you think this is a mistake, contact your super admin.' },
    ],
    footer: { kind: 'staff' },
  };
}

export interface AdminPasswordResetByAdminParams { adminName: string }
/** Never contains the temporary password: the super admin passes it on separately. */
export function adminPasswordResetByAdmin(p: AdminPasswordResetByAdminParams, ctx: TemplateContext): EmailDoc {
  return {
    subject: 'Your VHI CRM password was reset',
    preheader: 'A super admin reset your password.',
    greeting: greeting(p.adminName),
    blocks: [
      { kind: 'p', text: 'A super admin has reset your VHI CRM password. They will give you a temporary password; change it in Settings after you sign in.' },
      { kind: 'p', text: "If you weren't expecting this, contact your super admin straight away." },
      { kind: 'button', label: 'Sign in', url: ctx.links.adminLogin() },
    ],
    footer: { kind: 'staff' },
  };
}

export interface AdminPasswordChangedParams { adminName: string }
export function adminPasswordChanged(p: AdminPasswordChangedParams): EmailDoc {
  return {
    subject: 'Your VHI CRM password was changed',
    preheader: "If this wasn't you, contact your super admin.",
    greeting: greeting(p.adminName),
    blocks: [
      { kind: 'p', text: 'The password for your VHI CRM account was just changed.' },
      { kind: 'p', text: "If this wasn't you, contact your super admin straight away." },
    ],
    footer: { kind: 'staff' },
  };
}

export interface SupportMessageParams {
  customerName: string;
  customerEmail: string;
  userId: string;
  customerId: string;
  /** Messages in this email, oldest first (the group keeps the newest MESSAGE_GROUP_MAX). */
  messages: MessageEntry[];
  /** Total messages in the group (may exceed messages.length). */
  count: number;
}

// ---- Phase 4 digests (one email per admin per day; rows capped at DIGEST_MAX_ROWS by the jobs, `total` counts all)

const formatAmount = (amount: string) => {
  const [whole, fraction = ''] = oneLine(amount).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`;
};
const moreLine = (total: number, shown: number): EmailDoc['blocks'] =>
  total > shown ? [{ kind: 'p', text: `+${total - shown} more in the admin portal.` }] : [];

export interface OverdueDigestInvoice {
  invoiceId: string;
  number: string;
  customerName: string;
  /** Outstanding balance (DECIMAL as a string). */
  amount: string;
  currency: string;
  /** Already formatted ("6 Oct 2026"). */
  dueDate: string;
}
export interface AdminOverdueDigestParams {
  adminName: string;
  /** The run date, formatted. */
  date: string;
  invoices: OverdueDigestInvoice[];
  total: number;
}
export function adminOverdueDigest(p: AdminOverdueDigestParams, ctx: TemplateContext): EmailDoc {
  const total = Math.max(p.total, p.invoices.length);
  const first = p.invoices[0];
  const one = total === 1 && first;
  return {
    subject: one ? `Invoice ${oneLine(first.number)} is overdue` : `${total} invoices became overdue`,
    preheader: one
      ? `${oneLine(first.customerName) || 'A customer'} · ${oneLine(first.currency)} ${formatAmount(first.amount)} · due ${oneLine(first.dueDate)}`
      : `${total} invoices passed their due date.`,
    greeting: greeting(p.adminName),
    blocks: [
      { kind: 'p', text: one ? `This invoice became overdue today (${oneLine(p.date)}):` : `These invoices became overdue today (${oneLine(p.date)}):` },
      {
        kind: 'details',
        rows: p.invoices.map((i): [string, string] => [
          oneLine(i.number),
          `${oneLine(i.customerName) || 'Customer'} · ${oneLine(i.currency)} ${formatAmount(i.amount)} · due ${oneLine(i.dueDate)}`,
        ]),
      },
      ...moreLine(total, p.invoices.length),
      { kind: 'button', label: 'Open invoices', url: ctx.links.adminInvoices() },
    ],
    footer: { kind: 'staff', settingsUrl: ctx.links.adminNotificationSettings() },
  };
}

export interface RegistrationDigestCustomer {
  customerId: string;
  name: string;
  email: string;
  industry: string | null;
  /** ISO timestamp; shown as a time in APP_TIMEZONE. */
  verifiedAt: string;
}
export interface AdminRegistrationDigestParams {
  adminName: string;
  /** The day covered (yesterday), formatted. */
  date: string;
  customers: RegistrationDigestCustomer[];
  total: number;
}
export function adminRegistrationDigest(p: AdminRegistrationDigestParams, ctx: TemplateContext): EmailDoc {
  const total = Math.max(p.total, p.customers.length);
  const one = total === 1;
  return {
    subject: one ? '1 new customer registered yesterday' : `${total} new customers registered yesterday`,
    preheader: `New customer accounts verified on ${oneLine(p.date)}.`,
    greeting: greeting(p.adminName),
    blocks: [
      { kind: 'p', text: one ? `This customer verified their account on ${oneLine(p.date)}:` : `These customers verified their accounts on ${oneLine(p.date)}:` },
      {
        kind: 'details',
        rows: p.customers.map((c): [string, string] => [
          oneLine(c.name) || oneLine(c.email),
          [oneLine(c.email), c.industry ? modeLabel(c.industry) : 'no industry', formatTime(c.verifiedAt, ctx.timezone)].filter(Boolean).join(' · '),
        ]),
      },
      ...moreLine(total, p.customers.length),
      { kind: 'button', label: 'Open customers', url: ctx.links.adminCustomers() },
    ],
    footer: { kind: 'staff', settingsUrl: ctx.links.adminNotificationSettings() },
  };
}

/** One meta line + quote per message, oldest first. */
function messageBlocks(shown: MessageEntry[], timezone: string): EmailDoc['blocks'] {
  return shown.flatMap((m) => {
    const subject = oneLine(m.subject);
    const when = formatSentAt(m.sentAt, timezone);
    const meta = [when && `Sent ${when}`, subject && `Subject: ${subject}`].filter(Boolean).join(' · ');
    return [...(meta ? [{ kind: 'meta' as const, text: meta }] : []), { kind: 'quote' as const, text: m.body }];
  });
}

/** To the shared support inbox (SUPPORT_EMAIL, else SMTP_USER), as today. */
export function supportMessage(p: SupportMessageParams, ctx: TemplateContext): EmailDoc {
  const name = oneLine(p.customerName) || 'A customer';
  const total = Math.max(p.count, p.messages.length);
  const { shown, earlier } = selectMessages(p.messages, total);
  const many = total > 1;
  const who = `${name} (${oneLine(p.customerEmail)}, ${oneLine(p.userId)})`;
  return {
    subject: many ? `${total} new messages from ${name}` : `New message from ${name}`,
    preheader: Array.from(oneLine(shown[shown.length - 1]?.body ?? '')).slice(0, 120).join(''),
    blocks: [
      { kind: 'p', text: many ? `${who} sent ${total} messages in the customer portal:` : `${who} sent a message in the customer portal:` },
      ...(earlier > 0
        ? [{ kind: 'p' as const, text: `+${earlier} earlier message${earlier === 1 ? '' : 's'}. Open the conversation in the admin portal to see ${earlier === 1 ? 'it' : 'them'}.` }]
        : []),
      ...messageBlocks(shown, ctx.timezone),
      { kind: 'button', label: 'View and reply in the admin portal', url: ctx.links.adminCommunications(p.customerId) },
    ],
    footer: { kind: 'staff' },
  };
}
