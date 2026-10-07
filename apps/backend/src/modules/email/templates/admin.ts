// Staff-facing emails (individual admins and the support inbox). Copy approved in docs/PLAN-P3-EMAIL.md §4.
import { oneLine } from './html';
import { formatSentAt, MessageEntry, selectMessages } from './messages';
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
