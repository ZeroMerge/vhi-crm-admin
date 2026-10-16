// Communications over the notification stream (Phase 5): message ids in pushes, fetch-by-id, and explicit read marking.
// Shared by the admin (communications.routes.ts) and customer (client.communications.routes.ts) routers.
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { publishRealtime, RealtimeEvent } from '../notifications/realtime';

export const MAX_FETCH_IDS = 50;
export const MAX_READ_IDS = 200;

const uuid = z.string().uuid();

/**
 * `?ids=a,b` (or repeated `ids`): 1–50 UUIDs, deduplicated. Returns null when absent. Ids are only ever used together with the
 * thread's scope in SQL, so ids from another thread are silently left out (nothing reveals that they exist).
 */
export function parseIdsParam(raw: unknown): { ok: true; ids: string[] | null } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, ids: null };
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => (typeof v === 'string' ? v.split(',') : [null]));
  if (parts.some((p) => p === null)) return { ok: false, message: 'ids must be a comma-separated list of message ids' };
  const ids = [...new Set((parts as string[]).map((p) => p.trim().toLowerCase()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: 'ids must not be empty' };
  if (ids.length > MAX_FETCH_IDS) return { ok: false, message: `At most ${MAX_FETCH_IDS} ids` };
  if (!ids.every((id) => uuid.safeParse(id).success)) return { ok: false, message: 'ids must be message ids' };
  return { ok: true, ids };
}

/** `?markRead=false` turns off the legacy mark-on-GET (dual-run for one release; new UIs always send it). */
export const marksOnGet = (raw: unknown) => raw !== 'false';

export const readBodySchema = z
  .object({ messageIds: z.array(uuid).min(1).max(MAX_READ_IDS) })
  .strict();

/** The new message, pushed to the thread's customer and to every admin who currently has the communications module. */
export function messageCreatedEvents(customerId: string, messageId: string, senderType: 'admin' | 'customer'): RealtimeEvent[] {
  return [
    { kind: 'message_created', audience: { recipientType: 'customer', recipientId: customerId }, customerId, messageId, senderType },
    { kind: 'message_created', audience: { module: 'communications' }, customerId, messageId, senderType },
  ];
}

/**
 * Marks exactly the given messages read for one side, if they belong to the thread and were sent by the other side. No cursor or
 * timestamp: a message committed after the client rendered (even with an earlier created_at) is never marked.
 * The reader's message.received notifications for the thread are marked read only when nothing from the other side is still unread.
 * Publishes `read` (notifications) and `thread_read` (shared read state) on the caller's transaction.
 */
export async function markThreadRead(
  client: PoolClient,
  options: { customerId: string; readerSide: 'admin' | 'customer'; readerId: string; messageIds: string[] }
): Promise<{ updated: number; notificationIds: string[] }> {
  const { customerId, readerSide, readerId } = options;
  const messageIds = [...new Set(options.messageIds.map((id) => id.toLowerCase()))];
  const flag = readerSide === 'admin' ? 'read_by_admin' : 'read_by_customer';
  const otherSide = readerSide === 'admin' ? 'customer' : 'admin';

  const updated = await client.query(
    `UPDATE communications SET ${flag} = true
      WHERE customer_id = $1 AND sender_type = $2 AND ${flag} = false AND id = ANY($3::uuid[])
      RETURNING id`,
    [customerId, otherSide, messageIds]
  );
  const remaining = await client.query(
    `SELECT EXISTS (SELECT 1 FROM communications WHERE customer_id = $1 AND sender_type = $2 AND ${flag} = false) AS any`,
    [customerId, otherSide]
  );

  let notificationIds: string[] = [];
  if (!remaining.rows[0].any) {
    const column = readerSide === 'admin' ? 'admin_id' : 'customer_id';
    const read = await client.query(
      `UPDATE notifications SET read_at = NOW()
        WHERE ${column} = $1 AND type = 'message.received' AND entity_type = 'customer_thread'
          AND entity_id = $2 AND read_at IS NULL
        RETURNING id`,
      [readerId, customerId]
    );
    notificationIds = read.rows.map((r) => String(r.id));
  }

  const events: RealtimeEvent[] = [];
  if (notificationIds.length > 0) {
    events.push({ kind: 'read', recipientType: readerSide, recipientId: readerId, notificationIds });
  }
  if (updated.rows.length > 0) {
    // Admin read state is shared inbox state: every communications admin's unread counts change. Customer: their other tabs.
    const audience = readerSide === 'admin' ? ({ module: 'communications' } as const) : ({ recipientType: 'customer', recipientId: customerId } as const);
    events.push({ kind: 'thread_read', audience, customerId, side: readerSide });
  }
  await publishRealtime(events, client);
  return { updated: updated.rows.length, notificationIds };
}
