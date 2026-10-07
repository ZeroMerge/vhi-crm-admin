// Which notification events also send email (docs/PLAN-P3-EMAIL.md §6). Called by emit() on the same transaction,
// after the in-app rows are inserted. Recipient state and preferences are checked again by the worker at send time.
import type { PoolClient } from 'pg';
import type { NotificationEvent } from '../notifications/events';
import { enqueueEmail } from './outbox';
import { emailConfig } from '.';

export interface InsertedNotification {
  id: string;
  admin_id: string | null;
  customer_id: string | null;
}

export interface EventCustomer {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  user_id: string;
}

/** Customer-visible status changes that email. `processing` stays in-app only; corrections never reach here (shouldNotify). */
export const STATUS_EMAIL_TARGETS = new Set(['in_transit', 'clearance', 'delivered', 'cancelled', 'pending']);

const fullName = (c: EventCustomer) => `${c.firstname ?? ''} ${c.lastname ?? ''}`.trim();

export async function enqueueEventEmails(
  event: NotificationEvent,
  customer: EventCustomer,
  inserted: InsertedNotification[],
  client: PoolClient
): Promise<number> {
  const forCustomer = inserted.find((r) => r.customer_id === customer.id);
  let count = 0;

  switch (event.type) {
    case 'shipment.created': {
      // Same admins as the in-app notification (newly inserted rows only, so a re-emit never emails twice).
      const adminIds = inserted.map((r) => r.admin_id).filter((id): id is string => Boolean(id));
      if (adminIds.length === 0) return 0;
      const { rows: admins } = await client.query('SELECT id, name, email FROM admins WHERE id = ANY($1::uuid[])', [adminIds]);
      const byId = new Map(admins.map((a) => [a.id, a]));
      for (const row of inserted) {
        const admin = row.admin_id ? byId.get(row.admin_id) : null;
        if (!admin?.email) continue;
        await enqueueEmail(client, {
          kind: 'admin.shipment_created',
          to: admin.email,
          adminId: admin.id,
          notificationId: row.id,
          params: {
            adminName: admin.name ?? '',
            customerName: fullName(customer),
            orderId: event.shipment.orderId,
            shipmentId: event.shipment.id,
            shippingMode: event.shipment.shippingMode,
          },
        });
        count++;
      }
      return count;
    }

    case 'shipment.created_for_customer':
      if (!forCustomer) return 0;
      await enqueueEmail(client, {
        kind: 'customer.shipment_created',
        to: customer.email,
        customerId: customer.id,
        notificationId: forCustomer.id,
        params: { firstname: customer.firstname ?? '', orderId: event.shipment.orderId, status: event.shipment.status },
      });
      return 1;

    case 'shipment.status_changed':
      if (!forCustomer || event.isCorrection || !STATUS_EMAIL_TARGETS.has(event.to)) return 0;
      if (event.to === 'pending' && event.from !== 'cancelled') return 0; // only a real reopen
      await enqueueEmail(client, {
        kind: 'customer.shipment_status',
        to: customer.email,
        customerId: customer.id,
        notificationId: forCustomer.id,
        params: {
          firstname: customer.firstname ?? '',
          orderId: event.shipment.orderId,
          to: event.to,
          // Only the admin cancel reason, which the customer already sees in-app. Correction reasons never get here.
          reason: event.to === 'cancelled' ? event.reason : null,
        },
      });
      return 1;

    case 'shipment.tracking_assigned':
      if (!forCustomer) return 0;
      await enqueueEmail(client, {
        kind: 'customer.tracking_assigned',
        to: customer.email,
        customerId: customer.id,
        notificationId: forCustomer.id,
        params: { firstname: customer.firstname ?? '', orderId: event.shipment.orderId, awbNumber: event.awbNumber, bolNumber: event.bolNumber },
      });
      return 1;

    case 'message.received': {
      const cfg = emailConfig();
      const subject = event.subject ?? '';
      if (event.direction === 'to_customer') {
        // Service email: no preference; also reaches inactive customers (CRM leads), as before Phase 3.
        await enqueueEmail(client, {
          kind: 'customer.message',
          to: customer.email,
          customerId: customer.id,
          notificationId: forCustomer?.id ?? null,
          groupKey: `msg:to_customer:${customer.id}`,
          delayMs: cfg.messageBatchMs,
          params: { firstname: customer.firstname ?? '', count: 1, subject, body: event.text },
        });
        return 1;
      }
      // To the shared support inbox (SUPPORT_EMAIL, else SMTP_USER), whatever admins exist; skipped if neither is set, as before.
      if (!cfg.supportInbox) return 0;
      await enqueueEmail(client, {
        kind: 'support.message',
        to: cfg.supportInbox,
        groupKey: `msg:to_admins:${customer.id}`,
        delayMs: cfg.messageBatchMs,
        params: {
          customerName: fullName(customer),
          customerEmail: customer.email,
          userId: customer.user_id ?? '',
          customerId: customer.id,
          count: 1,
          subject,
          body: event.text,
        },
      });
      return 1;
    }

    case 'shipment.cancelled_by_client':
      return 0; // in-app only
  }
}
