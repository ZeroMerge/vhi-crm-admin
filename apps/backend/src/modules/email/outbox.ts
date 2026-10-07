// enqueueEmail: writes an email_deliveries row on the CALLER'S transaction client and wakes the worker on COMMIT
// (pg_notify is transactional: a rollback leaves no row and sends no wake-up).
import type { PoolClient } from 'pg';
import type { EmailKind, EmailParams } from './templates';

export const EMAIL_CHANNEL = 'vhi_email';

/** Params removed when a row finishes (sent, failed or cancelled): secrets and message texts. */
export const SENSITIVE_PARAMS = ['token', 'body', 'messages'];
/** Grouped emails keep at most this many messages (the newest); `count` still counts all of them. */
export const GROUP_KEEP_MESSAGES = 10;

export interface EnqueueEmail<K extends EmailKind> {
  kind: K;
  to: string;
  params: EmailParams<K>;
  adminId?: string | null;
  customerId?: string | null;
  notificationId?: string | null;
  /**
   * While a queued row with the same key exists it is updated instead of inserting another, atomically
   * (INSERT … ON CONFLICT DO UPDATE locks the row, so concurrent enqueues never lose each other's changes):
   * - `messages` arrays are APPENDED (oldest first; only the newest GROUP_KEEP_MESSAGES are stored),
   * - `count` values are added up,
   * - any other params are replaced by the newest (e.g. the newest reset token, hasPortal),
   * - send_after is kept (the batching window starts with the first message).
   */
  groupKey?: string | null;
  /** Delay before the first send (message batching). */
  delayMs?: number;
}

export async function enqueueEmail<K extends EmailKind>(client: PoolClient, input: EnqueueEmail<K>): Promise<{ id: string; grouped: boolean }> {
  const { rows } = await client.query(
    `INSERT INTO email_deliveries
       (kind, to_address, admin_id, customer_id, notification_id, params, group_key, send_after, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW() + make_interval(secs => $8::double precision / 1000),
             NOW() + make_interval(secs => $8::double precision / 1000))
     ON CONFLICT (group_key) WHERE status = 'queued' AND group_key IS NOT NULL
     DO UPDATE SET
       params = email_deliveries.params || (EXCLUDED.params - 'messages' - 'count')
                || CASE WHEN EXCLUDED.params ? 'count'
                        THEN jsonb_build_object('count',
                               COALESCE((email_deliveries.params->>'count')::int, 1) + COALESCE((EXCLUDED.params->>'count')::int, 1))
                        ELSE '{}'::jsonb END
                || CASE WHEN EXCLUDED.params ? 'messages'
                        THEN jsonb_build_object('messages', (
                               SELECT COALESCE(jsonb_agg(m.e ORDER BY m.ord), '[]'::jsonb)
                                 FROM jsonb_array_elements(COALESCE(email_deliveries.params->'messages', '[]'::jsonb) || (EXCLUDED.params->'messages'))
                                      WITH ORDINALITY AS m(e, ord)
                                WHERE m.ord > jsonb_array_length(COALESCE(email_deliveries.params->'messages', '[]'::jsonb) || (EXCLUDED.params->'messages'))
                                              - ${GROUP_KEEP_MESSAGES}))
                        ELSE '{}'::jsonb END,
       to_address = EXCLUDED.to_address,
       notification_id = COALESCE(EXCLUDED.notification_id, email_deliveries.notification_id)
     RETURNING id::text AS id, (xmax <> 0) AS grouped`,
    [
      input.kind,
      input.to,
      input.adminId ?? null,
      input.customerId ?? null,
      input.notificationId ?? null,
      JSON.stringify(input.params),
      input.groupKey ?? null,
      Math.max(0, input.delayMs ?? 0),
    ]
  );
  await client.query(`SELECT pg_notify('${EMAIL_CHANNEL}', '')`);
  return { id: rows[0].id, grouped: rows[0].grouped };
}
