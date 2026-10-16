// Daily 07:00 (APP_TIMEZONE): overdue invoices alert finance staff in-app, then once every OVERDUE_REMINDER_DAYS while unpaid,
// at most OVERDUE_MAX_REMINDERS times. Invoices that became overdue in this run are also emailed as one digest per admin
// (preference overdue_alert). Drafts were never sent, so they are never overdue (D6). Invoices without a customer are skipped.
import type { Job } from '../scheduler';
import { emit } from '../../notifications/notification.service';
import { rolesWithModule } from '../../../middleware/permissions';
import { enqueueEmail } from '../../email/outbox';
import { normaliseAdminPrefs } from '../../email/preferences';
import type { OverdueDigestInvoice } from '../../email/templates/admin';
import { formatDate, localDate, zonedTimeToInstant } from '../../../utils/appTime';
import { DIGEST_MAX_ROWS, digestRecipients } from './digest';

/** "2026-10-06" → "6 Oct 2026" (a calendar date: no time zone conversion). */
export const formatYmd = (ymd: string) => formatDate(zonedTimeToInstant(ymd, 12, 0, 'UTC'), 'UTC');

export const overdueInvoicesJob: Job = {
  name: 'overdue-invoices',
  schedule: { dailyAt: '07:00' },
  async run({ client, now, config }) {
    const today = localDate(now, config.timezone);
    // n = reminder number: 0 on the first overdue day (due date + 1), 1 a reminder period later, and so on.
    const { rows } = await client.query(
      `WITH overdue AS (
         SELECT i.id, i.invoice_number, i.customer_id, COALESCE(i.currency, 'NGN') AS currency, i.due_date,
                ($1::date - i.due_date) AS days_overdue,
                (($1::date - i.due_date) - 1) / $2::int AS n,
                (i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.payment_status = 'success'), 0))::text
                  AS outstanding
           FROM invoices i
          WHERE i.due_date < $1::date
            AND i.status::text NOT IN ('paid', 'draft')
            AND i.customer_id IS NOT NULL
       )
       SELECT o.id, o.invoice_number, o.customer_id, o.currency, o.due_date::text AS due_date, o.days_overdue, o.n, o.outstanding,
              c.firstname, c.lastname
         FROM overdue o
         JOIN customers c ON c.id = o.customer_id
        WHERE o.n <= $3
          AND NOT EXISTS (SELECT 1 FROM notifications nt WHERE nt.dedupe_key = 'invoice.overdue:' || o.id || ':' || o.n)
        ORDER BY o.due_date, o.invoice_number`,
      [today, config.overdueReminderDays, config.overdueMaxReminders]
    );

    const newlyOverdue: OverdueDigestInvoice[] = [];
    let notifications = 0;
    for (const r of rows) {
      const dueDate = formatYmd(r.due_date);
      const inserted = await emit(
        {
          type: 'invoice.overdue',
          actor: { type: 'system', id: null },
          sourceId: `${r.id}:${r.n}`,
          invoice: { id: r.id, number: r.invoice_number, customerId: r.customer_id, amount: r.outstanding, currency: r.currency, dueDate },
          daysOverdue: r.days_overdue,
          reminder: r.n,
        },
        client
      );
      notifications += inserted;
      if (r.n === 0 && inserted > 0) {
        newlyOverdue.push({
          invoiceId: r.id,
          number: r.invoice_number,
          customerName: `${r.firstname ?? ''} ${r.lastname ?? ''}`.trim(),
          amount: r.outstanding,
          currency: r.currency,
          dueDate,
        });
      }
    }

    let emails = 0;
    if (newlyOverdue.length > 0) {
      const recipients = await digestRecipients(client, {
        roles: rolesWithModule('invoices'),
        groupKeyPrefix: `overdue-digest:${today}:`,
        wants: (prefs) => normaliseAdminPrefs(prefs).overdue_alert,
      });
      for (const admin of recipients) {
        await enqueueEmail(client, {
          kind: 'admin.overdue_digest',
          to: admin.email,
          adminId: admin.id,
          groupKey: `overdue-digest:${today}:${admin.id}`,
          params: { adminName: admin.name ?? '', date: formatYmd(today), invoices: newlyOverdue.slice(0, DIGEST_MAX_ROWS), total: newlyOverdue.length },
        });
        emails++;
      }
    }
    return `${rows.length} invoice(s) due an alert, ${notifications} notification(s), ${newlyOverdue.length} newly overdue, ${emails} digest email(s)`;
  },
};
