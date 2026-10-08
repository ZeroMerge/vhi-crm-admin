// Daily 03:30 (APP_TIMEZONE): retention (RISKS R-56). Deletes in batches of CLEANUP_BATCH rows, each batch its own short
// transaction (autocommit on the pool), so no long lock is held. Queued and sending emails are never deleted.
import type { Pool } from 'pg';
import type { Job } from '../scheduler';

export const CLEANUP_BATCH = 5_000;
const DAY_MS = 86_400_000;

async function deleteInBatches(pool: Pool, table: string, key: string, where: string, cutoff: Date): Promise<number> {
  let total = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE ${where} ORDER BY ${key} LIMIT ${CLEANUP_BATCH})`,
      [cutoff]
    );
    total += rowCount ?? 0;
    if ((rowCount ?? 0) < CLEANUP_BATCH) return total;
  }
}

export const cleanupJob: Job = {
  name: 'cleanup',
  schedule: { dailyAt: '03:30' },
  async run({ pool, now, config }) {
    const r = config.retention;
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const read = await deleteInBatches(pool, 'notifications', 'id', 'read_at IS NOT NULL AND created_at < $1', before(r.notificationsReadDays));
    const unread = await deleteInBatches(pool, 'notifications', 'id', 'read_at IS NULL AND created_at < $1', before(r.notificationsUnreadDays));
    const emails = await deleteInBatches(
      pool,
      'email_deliveries',
      'id',
      `status IN ('sent', 'failed', 'cancelled') AND created_at < $1`,
      before(r.emailDeliveriesDays)
    );
    const webhooks = await deleteInBatches(pool, 'processed_webhooks', 'id', 'received_at < $1', before(r.webhooksDays));
    return `deleted ${read} read + ${unread} unread notification(s), ${emails} email row(s), ${webhooks} webhook id(s)`;
  },
};
