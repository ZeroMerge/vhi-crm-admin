// Sample params for every email template: used by `npm run email:preview` and by test/email.templates.test.ts.
import type { EmailKind, EmailParams } from '.';

export const XSS = `<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" 'single' \`tick\` & ampersand`;

export interface Sample<K extends EmailKind = EmailKind> {
  id: string;
  kind: K;
  note: string;
  params: EmailParams<K>;
  supportReplyTo?: boolean;
}
const sample = <K extends EmailKind>(s: Sample<K>) => s as unknown as Sample;

const multiLine = 'Hello Ada,\n\nYour pickup is booked for Friday between 9am and 12pm.\nPlease have the commercial invoice ready.\n\nThanks,\nVHI Support';

export const SAMPLES: Sample[] = [
  sample({ id: 'c1-verify', kind: 'customer.verify_email', note: 'Production only, as today', params: { firstname: 'Ada', token: 'a1b2c3d4e5f6' } }),
  sample({ id: 'c2-reset', kind: 'customer.password_reset', note: 'Newest token only (grouped)', params: { firstname: 'Ada', token: 'f6e5d4c3b2a1' } }),
  sample({ id: 'c3-password-changed', kind: 'customer.password_changed', note: 'SUPPORT_EMAIL set', params: { firstname: 'Ada' }, supportReplyTo: true }),
  sample({ id: 'c3-password-changed-no-support', kind: 'customer.password_changed', note: 'SUPPORT_EMAIL not set', params: { firstname: 'Ada' } }),
  sample({ id: 'c4-shipment-created', kind: 'customer.shipment_created', note: 'Shipment updates (preference)', params: { firstname: 'Ada', orderId: 'VHI-AF-104233', status: 'pending' } }),
  sample({ id: 'c5-in-transit', kind: 'customer.shipment_status', note: 'Status → in_transit', params: { firstname: 'Ada', orderId: 'VHI-AF-104233', to: 'in_transit' } }),
  sample({ id: 'c5-clearance', kind: 'customer.shipment_status', note: 'Status → clearance', params: { firstname: 'Ada', orderId: 'VHI-AF-104233', to: 'clearance' } }),
  sample({ id: 'c5-delivered', kind: 'customer.shipment_status', note: 'Status → delivered', params: { firstname: 'Ada', orderId: 'VHI-AF-104233', to: 'delivered' } }),
  sample({
    id: 'c5-cancelled-reason',
    kind: 'customer.shipment_status',
    note: 'Cancelled with the admin reason (already shown in-app)',
    params: { firstname: 'Ada', orderId: 'VHI-AF-104233', to: 'cancelled', reason: 'Goods are restricted for air freight.\nPlease contact us to rebook by sea.' },
  }),
  sample({ id: 'c5-cancelled-no-reason', kind: 'customer.shipment_status', note: 'Cancelled without a reason', params: { firstname: 'Ada', orderId: 'VHI-AF-104233', to: 'cancelled' } }),
  sample({ id: 'c5-reopened', kind: 'customer.shipment_status', note: 'Cancelled → pending (reopen)', params: { firstname: 'Ada', orderId: 'VHI-AF-104233', to: 'pending' } }),
  sample({ id: 'c6-tracking-both', kind: 'customer.tracking_assigned', note: 'AWB and BOL', params: { firstname: 'Ada', orderId: 'VHI-SF-200871', awbNumber: '176-12345675', bolNumber: 'MSCU1234567890123-LONG-REFERENCE' } }),
  sample({ id: 'c6-tracking-awb', kind: 'customer.tracking_assigned', note: 'AWB only', params: { firstname: 'Ada', orderId: 'VHI-AF-104233', awbNumber: '176-12345675' } }),
  sample({ id: 'c7-message', kind: 'customer.message', note: 'One message, full text', params: { firstname: 'Ada', count: 1, subject: 'Pickup booked', body: multiLine } }),
  sample({ id: 'c7-message-grouped', kind: 'customer.message', note: '3 messages within the batch window (latest shown in full)', params: { firstname: 'Ada', count: 3, subject: 'Re: documents', body: 'We have received the documents, thank you.' } }),
  sample({
    id: 's1-support',
    kind: 'support.message',
    note: 'To SUPPORT_EMAIL inbox',
    params: { customerName: 'Ada Obi', customerEmail: 'ada@example.com', userId: 'VHI-3F9A21C0', customerId: '0b7c1f9e-0000-4000-8000-000000000001', count: 1, subject: 'Question about my invoice', body: 'Hi, could you tell me when the invoice for VHI-AF-104233 will be ready?\nThanks' },
  }),
  sample({
    id: 's1-support-grouped',
    kind: 'support.message',
    note: '3 messages grouped',
    params: { customerName: 'Ada Obi', customerEmail: 'ada@example.com', userId: 'VHI-3F9A21C0', customerId: '0b7c1f9e-0000-4000-8000-000000000001', count: 3, subject: 'Re: invoice', body: 'Never mind, found it.' },
  }),
  sample({
    id: 'a1-shipment-created',
    kind: 'admin.shipment_created',
    note: 'Admin preference shipment_created (default on)',
    params: { adminName: 'Tunde', customerName: 'Ada Obi', orderId: 'VHI-AF-104233', shipmentId: '5b97855b-19f6-49c3-9a03-a7c057cb031c', shippingMode: 'air_freight' },
  }),
  sample({ id: 'a2-roles-changed', kind: 'admin.roles_changed', note: 'Service', params: { adminName: 'Tunde', roles: ['manager', 'logistics_officer'] } }),
  sample({ id: 'a3-deactivated', kind: 'admin.deactivated', note: 'Service (status → inactive only)', params: { adminName: 'Tunde' } }),
  sample({ id: 'a4-reset-by-admin', kind: 'admin.password_reset_by_admin', note: 'Service; never includes the temporary password', params: { adminName: 'Tunde' } }),
  sample({ id: 'a5-password-changed', kind: 'admin.password_changed', note: 'Service', params: { adminName: 'Tunde' } }),
  // ---- hostile samples: everything below must render as plain text
  sample({
    id: 'x1-message-payload',
    kind: 'customer.message',
    note: 'ESCAPING: markup in name, subject and body; CR/LF in subject',
    params: { firstname: XSS, count: 1, subject: 'Hello\r\nBcc: victim@example.com\r\nX-Injected: 1', body: `${XSS}\n<a href="javascript:alert(3)">click</a>` },
  }),
  sample({
    id: 'x2-reason-payload',
    kind: 'customer.shipment_status',
    note: 'ESCAPING: markup in cancel reason and order id',
    params: { firstname: 'Ada', orderId: '"><img src=x onerror=alert(4)>', to: 'cancelled', reason: XSS },
  }),
  sample({
    id: 'x3-support-payload',
    kind: 'support.message',
    note: 'ESCAPING: markup in customer name, email and body; 150-char subject cap',
    params: { customerName: `${XSS} ${'Very Long Name '.repeat(12)}`, customerEmail: '"onmouseover=alert(5)"@example.com', userId: '<b>VHI</b>', customerId: '../../etc/passwd?x=1#y', count: 1, subject: XSS, body: XSS },
  }),
];
