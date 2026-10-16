// Daily 08:00 (APP_TIMEZONE): one email per growth admin (preference `registration`) listing the customers who verified their
// accounts yesterday (00:00–24:00 in APP_TIMEZONE). Nothing is sent when nobody registered. The in-app alert is real time
// (customer.registered, emitted at verification).
import type { Job } from '../scheduler';
import { enqueueEmail } from '../../email/outbox';
import { normaliseAdminPrefs } from '../../email/preferences';
import { CUSTOMER_GROWTH_ROLES } from '../../notifications/events';
import { addDays, localDate, zonedTimeToInstant } from '../../../utils/appTime';
import { DIGEST_MAX_ROWS, digestRecipients } from './digest';
import { formatYmd } from './overdueInvoices';

export const registrationDigestJob: Job = {
  name: 'registration-digest',
  schedule: { dailyAt: '08:00' },
  async run({ client, now, config }) {
    const today = localDate(now, config.timezone);
    const yesterday = addDays(today, -1);
    const from = zonedTimeToInstant(yesterday, 0, 0, config.timezone);
    const to = zonedTimeToInstant(today, 0, 0, config.timezone);
    const { rows } = await client.query(
      `SELECT id, firstname, lastname, email, industry::text AS industry, verified_at, COUNT(*) OVER () AS total
         FROM customers
        WHERE verified_at >= $1 AND verified_at < $2
        ORDER BY verified_at, id
        LIMIT $3`,
      [from, to, DIGEST_MAX_ROWS]
    );
    if (rows.length === 0) return 'no registrations yesterday';
    const total = Number(rows[0].total);
    const customers = rows.map((r) => ({
      customerId: r.id,
      name: `${r.firstname ?? ''} ${r.lastname ?? ''}`.trim(),
      email: r.email,
      industry: r.industry ?? null,
      verifiedAt: (r.verified_at as Date).toISOString(),
    }));

    const recipients = await digestRecipients(client, {
      roles: CUSTOMER_GROWTH_ROLES,
      groupKeyPrefix: `reg-digest:${today}:`,
      wants: (prefs) => normaliseAdminPrefs(prefs).registration,
    });
    for (const admin of recipients) {
      await enqueueEmail(client, {
        kind: 'admin.registration_digest',
        to: admin.email,
        adminId: admin.id,
        groupKey: `reg-digest:${today}:${admin.id}`,
        params: { adminName: admin.name ?? '', date: formatYmd(yesterday), customers, total },
      });
    }
    return `${total} registration(s), ${recipients.length} digest email(s)`;
  },
};
