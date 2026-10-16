import type { AppNotification } from '@/services/notification.service';

// Where clicking a notification goes, derived from its entity (see apps/backend/src/modules/notifications/events.ts).
export function notificationLink(n: Pick<AppNotification, 'entityType' | 'entityId'>): string | null {
  switch (n.entityType) {
    case 'shipment':
      return `/admin/shipments/${n.entityId}`;
    case 'customer_thread':
      return `/admin/communications?selected=${encodeURIComponent(n.entityId)}`;
    // Phase 4: invoice.overdue → the invoice; customer.registered and email.bounced → the customer.
    case 'invoice':
      return `/admin/invoices/${encodeURIComponent(n.entityId)}`;
    case 'customer':
      return `/admin/customers/${encodeURIComponent(n.entityId)}`;
    default:
      return null;
  }
}
