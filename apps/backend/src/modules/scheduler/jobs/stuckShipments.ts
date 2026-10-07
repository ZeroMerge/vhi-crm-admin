// Hourly: shipments with no status change for longer than their status's threshold alert shipment operations staff (in-app).
// One alert per stuck period, then one reminder every STUCK_REMINDER_DAYS, at most STUCK_MAX_REMINDERS times. Any transition
// (corrections too) moves status_changed_at, which starts a new period. After downtime only the current reminder is sent.
import type { Job } from '../scheduler';
import { emit } from '../../notifications/notification.service';
import { formatDate } from '../../../utils/appTime';

const DAY_MS = 86_400_000;

export const stuckShipmentsJob: Job = {
  name: 'stuck-shipments',
  schedule: { everyMinutes: 60 },
  async run({ client, now, config }) {
    const h = config.stuckHours;
    // n = how many reminder periods have passed since the shipment crossed its threshold (0 = the first alert).
    // source_id identifies (shipment, stuck period, n); the per-recipient dedupe key makes each one alert exactly once.
    const { rows } = await client.query(
      `WITH open AS (
         SELECT s.id, s.order_id, s.customer_id, s.status::text AS status, s.status_changed_at,
                CASE s.status::text WHEN 'pending' THEN $1::int WHEN 'processing' THEN $2::int WHEN 'in_transit' THEN $3::int WHEN 'clearance' THEN $4::int END
                  AS threshold_hours
           FROM shipments s
          WHERE s.status::text IN ('pending', 'processing', 'in_transit', 'clearance')
       ), stuck AS (
         SELECT o.*,
                floor(EXTRACT(EPOCH FROM ($5::timestamptz - (o.status_changed_at + make_interval(hours => o.threshold_hours))))
                      / ($6::int * 86400))::int AS n
           FROM open o
          WHERE o.status_changed_at + make_interval(hours => o.threshold_hours) <= $5::timestamptz
       )
       SELECT st.*, st.id || ':' || st.status || ':' || floor(EXTRACT(EPOCH FROM st.status_changed_at))::bigint || ':' || st.n AS source_id
         FROM stuck st
        WHERE st.n <= $7
          AND NOT EXISTS (SELECT 1 FROM notifications nt
                           WHERE nt.dedupe_key = 'shipment.stuck:' || st.id || ':' || st.status || ':'
                                                 || floor(EXTRACT(EPOCH FROM st.status_changed_at))::bigint || ':' || st.n)
        ORDER BY st.status_changed_at, st.id`,
      [h.pending, h.processing, h.in_transit, h.clearance, now, config.stuckReminderDays, config.stuckMaxReminders]
    );

    let alerted = 0;
    let notifications = 0;
    for (const r of rows) {
      const changedAt: Date = r.status_changed_at;
      const inserted = await emit(
        {
          type: 'shipment.stuck',
          actor: { type: 'system', id: null },
          sourceId: r.source_id,
          shipment: { id: r.id, orderId: r.order_id, customerId: r.customer_id },
          status: r.status,
          days: Math.floor((now.getTime() - changedAt.getTime()) / DAY_MS),
          thresholdHours: r.threshold_hours,
          since: formatDate(changedAt, config.timezone),
          reminder: r.n,
        },
        client
      );
      if (inserted > 0) alerted++;
      notifications += inserted;
    }
    return `${alerted} shipment(s) alerted, ${notifications} notification(s)`;
  },
};
