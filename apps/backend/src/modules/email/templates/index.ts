// Email template registry: one entry per `email_deliveries.kind`.
import * as customer from './customer';
import * as admin from './admin';
import type { TemplateContext } from './context';
import { renderEmail, RenderedEmail, EmailDoc } from './layout';

export type EmailAudience = 'customer' | 'admin' | 'support';
/** Preference keys that can switch an email off. Emails without one are service emails (no opt-out, no unsubscribe link). */
export type EmailPreference = 'shipment_updates' | 'shipment_created';

interface TemplateDef<P> {
  audience: EmailAudience;
  preference: EmailPreference | null;
  render: (params: P, ctx: TemplateContext) => EmailDoc;
}

const def = <P>(audience: EmailAudience, preference: EmailPreference | null, render: (params: P, ctx: TemplateContext) => EmailDoc): TemplateDef<P> => ({
  audience,
  preference,
  render,
});

export const EMAIL_TEMPLATES = {
  'customer.verify_email': def('customer', null, customer.verifyEmail),
  'customer.password_reset': def('customer', null, customer.passwordReset),
  'customer.password_changed': def('customer', null, customer.passwordChanged),
  'customer.shipment_created': def('customer', 'shipment_updates', customer.shipmentCreated),
  'customer.shipment_status': def('customer', 'shipment_updates', customer.shipmentStatus),
  'customer.tracking_assigned': def('customer', 'shipment_updates', customer.trackingAssigned),
  'customer.message': def('customer', null, customer.customerMessage),
  'support.message': def('support', null, admin.supportMessage),
  'admin.shipment_created': def('admin', 'shipment_created', admin.adminShipmentCreated),
  'admin.roles_changed': def('admin', null, admin.adminRolesChanged),
  'admin.deactivated': def('admin', null, admin.adminDeactivated),
  'admin.password_reset_by_admin': def('admin', null, admin.adminPasswordResetByAdmin),
  'admin.password_changed': def('admin', null, admin.adminPasswordChanged),
};

export type EmailKind = keyof typeof EMAIL_TEMPLATES;
export type EmailParams<K extends EmailKind> = Parameters<(typeof EMAIL_TEMPLATES)[K]['render']>[0];

export const isEmailKind = (kind: string): kind is EmailKind => Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, kind);

export function renderTemplate<K extends EmailKind>(kind: K, params: EmailParams<K>, ctx: TemplateContext): RenderedEmail {
  const template = EMAIL_TEMPLATES[kind] as TemplateDef<EmailParams<K>>;
  return renderEmail(template.render(params, ctx), ctx.brand);
}

export { templateContext } from './context';
export type { TemplateContext } from './context';
export type { RenderedEmail } from './layout';
