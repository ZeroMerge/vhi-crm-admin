// Customer-facing emails. Copy approved in docs/PLAN-P3-EMAIL.md §4. Never include internal data (correction reasons, notes, staff names).
import { customerStatusLabel } from '../../notifications/events';
import { oneLine } from './html';
import { formatSentAt, MessageEntry, selectMessages } from './messages';
import type { EmailDoc } from './layout';
import type { TemplateContext } from './context';

const greeting = (firstname: string) => (oneLine(firstname) ? `Hi ${oneLine(firstname)},` : 'Hello,');

export interface VerifyEmailParams { firstname: string; token: string }
export function verifyEmail(p: VerifyEmailParams, ctx: TemplateContext): EmailDoc {
  return {
    subject: 'Verify your VHI account',
    preheader: 'Confirm your email address to activate your VHI account.',
    greeting: greeting(p.firstname),
    blocks: [
      { kind: 'p', text: 'Please confirm your email address to activate your VHI account. This link expires in 24 hours.' },
      { kind: 'button', label: 'Verify email address', url: ctx.links.verifyEmail(p.token), showUrl: true },
      { kind: 'p', text: "If you didn't create a VHI account, you can ignore this email." },
    ],
    footer: { kind: 'service' },
  };
}

export interface PasswordResetParams { firstname: string; token: string }
export function passwordReset(p: PasswordResetParams, ctx: TemplateContext): EmailDoc {
  return {
    subject: 'Reset your VHI password',
    preheader: 'Use this link within 1 hour to choose a new password.',
    greeting: greeting(p.firstname),
    blocks: [
      { kind: 'p', text: 'We received a request to reset your password. This link expires in 1 hour.' },
      { kind: 'button', label: 'Reset password', url: ctx.links.resetPassword(p.token), showUrl: true },
      { kind: 'p', text: "If you didn't ask for this, you can ignore this email. Your password won't change." },
    ],
    footer: { kind: 'service' },
  };
}

export interface PasswordChangedParams { firstname: string }
export function passwordChanged(p: PasswordChangedParams, ctx: TemplateContext): EmailDoc {
  return {
    subject: 'Your VHI password was changed',
    preheader: 'If this was you, there is nothing else to do.',
    greeting: greeting(p.firstname),
    blocks: [
      { kind: 'p', text: "The password for your VHI account was just changed. If this was you, there's nothing else to do." },
      {
        kind: 'p',
        text: `If it wasn't you, reset your password now${ctx.supportReplyTo ? ' and let us know by replying to this email' : ''}.`,
      },
      { kind: 'button', label: 'Reset password', url: ctx.links.forgotPassword() },
    ],
    footer: { kind: 'service' },
  };
}

export interface ShipmentCreatedParams { firstname: string; orderId: string; status: string }
export function shipmentCreated(p: ShipmentCreatedParams, ctx: TemplateContext): EmailDoc {
  const orderId = oneLine(p.orderId);
  return {
    subject: `New shipment ${orderId} created for you`,
    preheader: `Current status: ${customerStatusLabel(p.status)}.`,
    greeting: greeting(p.firstname),
    blocks: [
      { kind: 'p', text: `VHI has created shipment ${orderId} for you. Current status: ${customerStatusLabel(p.status)}.` },
      { kind: 'button', label: 'Track shipment', url: ctx.links.tracking(p.orderId) },
    ],
    footer: ctx.preferenceFooter(),
  };
}

export interface ShipmentStatusParams { firstname: string; orderId: string; to: string; reason?: string | null }
export function shipmentStatus(p: ShipmentStatusParams, ctx: TemplateContext): EmailDoc {
  const orderId = oneLine(p.orderId);
  const copy: Record<string, { subject: string; text: string }> = {
    in_transit: { subject: `Shipment ${orderId} is in transit`, text: `Your shipment ${orderId} is on its way to its destination.` },
    clearance: { subject: `Shipment ${orderId} is in customs clearance`, text: `Your shipment ${orderId} is now in customs clearance.` },
    delivered: { subject: `Shipment ${orderId} has been delivered`, text: `Your shipment ${orderId} has been delivered.` },
    cancelled: { subject: `Shipment ${orderId} was cancelled`, text: `Your shipment ${orderId} was cancelled.` },
    pending: { subject: `Shipment ${orderId} is active again`, text: `Your shipment ${orderId} has been reopened and is pending again.` },
  };
  const label = customerStatusLabel(p.to);
  const c = copy[p.to] ?? { subject: `Shipment ${orderId} is now ${label.toLowerCase()}`, text: `Your shipment ${orderId} is now ${label.toLowerCase()}.` };
  const blocks: EmailDoc['blocks'] = [{ kind: 'p', text: c.text }];
  if (p.to === 'cancelled') {
    // The admin's cancel reason is already shown to the customer in-app; corrections never reach this template.
    if (p.reason && p.reason.trim()) {
      blocks.push({ kind: 'p', text: 'Reason:' }, { kind: 'quote', text: p.reason.trim() });
    } else {
      blocks.push({ kind: 'p', text: 'It will not be processed further.' });
    }
  }
  blocks.push({ kind: 'button', label: 'Track shipment', url: ctx.links.tracking(p.orderId) });
  return { subject: c.subject, preheader: c.text, greeting: greeting(p.firstname), blocks, footer: ctx.preferenceFooter() };
}

export interface TrackingAssignedParams { firstname: string; orderId: string; awbNumber?: string | null; bolNumber?: string | null }
export function trackingAssigned(p: TrackingAssignedParams, ctx: TemplateContext): EmailDoc {
  const orderId = oneLine(p.orderId);
  const rows: Array<[string, string]> = [];
  if (p.awbNumber) rows.push(['Air waybill (AWB)', oneLine(p.awbNumber)]);
  if (p.bolNumber) rows.push(['Bill of lading (BOL)', oneLine(p.bolNumber)]);
  return {
    subject: `Tracking number added for ${orderId}`,
    preheader: rows.map(([l, v]) => `${l}: ${v}`).join(' · '),
    greeting: greeting(p.firstname),
    blocks: [
      { kind: 'p', text: `A tracking number has been added to shipment ${orderId}:` },
      { kind: 'details', rows },
      { kind: 'button', label: 'Track shipment', url: ctx.links.tracking(p.orderId) },
    ],
    footer: ctx.preferenceFooter(),
  };
}

export interface CustomerMessageParams {
  firstname: string;
  /** Messages in this email, oldest first (the group keeps the newest MESSAGE_GROUP_MAX). */
  messages: MessageEntry[];
  /** Total messages in the group (may exceed messages.length). */
  count: number;
  /** Active customers can open the portal; CRM leads (no account) get no portal button. Frozen at enqueue. */
  hasPortal: boolean;
}

/** One meta line + quote per message, oldest first. */
function messageBlocks(shown: MessageEntry[]): EmailDoc['blocks'] {
  return shown.flatMap((m) => {
    const subject = oneLine(m.subject);
    const when = formatSentAt(m.sentAt);
    const meta = [when && `Sent ${when}`, subject && `Subject: ${subject}`].filter(Boolean).join(' · ');
    return [...(meta ? [{ kind: 'meta' as const, text: meta }] : []), { kind: 'quote' as const, text: m.body }];
  });
}

export function customerMessage(p: CustomerMessageParams, ctx: TemplateContext): EmailDoc {
  const total = Math.max(p.count, p.messages.length);
  const { shown, earlier } = selectMessages(p.messages, total);
  const many = total > 1;
  const single = shown[shown.length - 1];
  const intro = many ? `You have ${total} new messages from VHI Support:` : 'You have a new message from VHI Support:';
  return {
    subject: many ? `${total} new messages from VHI` : oneLine(single?.subject ?? '') ? `New message from VHI: ${oneLine(single.subject)}` : 'New message from VHI',
    preheader: Array.from(oneLine(single?.body ?? '')).slice(0, 120).join(''),
    greeting: greeting(p.firstname),
    blocks: [
      { kind: 'p', text: intro },
      ...(earlier > 0
        ? [{ kind: 'p' as const, text: `+${earlier} earlier message${earlier === 1 ? '' : 's'}. Reply to this email or contact support to see ${earlier === 1 ? 'it' : 'them'}.` }]
        : []),
      ...messageBlocks(shown),
      ...(p.hasPortal ? [{ kind: 'button' as const, label: 'View conversation', url: ctx.links.clientMail() }] : []),
    ],
    footer: { kind: 'service' },
  };
}
