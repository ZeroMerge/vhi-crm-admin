import type { PoolClient } from 'pg';
import { rolesWithModule } from '../../middleware/permissions';
import { CATALOG, CatalogEntry, NotificationEvent, NotificationType, RenderContext } from './events';
import { publishRealtime, RealtimeEvent } from './realtime';

// Recipient roles for an admin-audience entry: the entry's narrower `roles`, else everyone who can see its module.
export function recipientRoles(entry: Pick<CatalogEntry<NotificationType>, 'module' | 'roles'>): string[] {
  if (!entry.module) return [];
  return entry.roles ?? rolesWithModule(entry.module);
}

interface Recipient {
  adminId: string | null;
  customerId: string | null;
}

/**
 * Writes the notifications for one event using the CALLER'S transaction client, so they only exist if the
 * caller commits. Must be called inside BEGIN/COMMIT. Returns the number of rows inserted.
 */
export async function emit(event: NotificationEvent, client: PoolClient): Promise<number> {
  const entry = CATALOG[event.type] as CatalogEntry<NotificationType>;
  const e = event as never;
  if (entry.shouldNotify && !entry.shouldNotify(e)) return 0;

  const customerId = entry.customerId(e);
  const entity = entry.entity(e);
  const audience = entry.audience(e);
  const actorId = event.actor.id;

  const customerRow = await client.query('SELECT firstname, lastname FROM customers WHERE id = $1', [customerId]);
  if (customerRow.rows.length === 0) return 0;
  const customer = { firstname: customerRow.rows[0].firstname ?? '', lastname: customerRow.rows[0].lastname ?? '' };

  let recipients: Recipient[];
  if (audience === 'customer') {
    recipients = event.actor.type === 'customer' && actorId === customerId ? [] : [{ adminId: null, customerId }];
  } else {
    const { rows } = await client.query(
      `SELECT id FROM admins
        WHERE is_active IS NOT FALSE AND deleted_at IS NULL
          AND assigned_roles && $1::text[]
          AND ($2::uuid IS NULL OR id <> $2::uuid)
        ORDER BY id`,
      [recipientRoles(entry), event.actor.type === 'admin' ? actorId : null]
    );
    recipients = rows.map((r) => ({ adminId: r.id, customerId: null }));
  }
  if (recipients.length === 0) return 0;

  // Dedupe before grouping: a recipient who already has a row for this source event gets nothing new
  // (otherwise grouping would delete it and re-insert it with a higher count). ON CONFLICT still guards races.
  const dedupeKey = `${event.type}:${event.sourceId}`;
  const ids = recipients.map((r) => (r.adminId ?? r.customerId) as string);
  const existing = await client.query(
    `SELECT COALESCE(admin_id, customer_id) AS recipient_id FROM notifications
      WHERE dedupe_key = $1 AND (admin_id = ANY($2::uuid[]) OR customer_id = ANY($2::uuid[]))`,
    [dedupeKey, ids]
  );
  const done = new Set(existing.rows.map((r) => r.recipient_id));
  recipients = recipients.filter((r) => !done.has(r.adminId ?? r.customerId));
  if (recipients.length === 0) return 0;

  // Grouping (message.received): replace each recipient's UNREAD notification for the same entity with a new row
  // (new id → top of the feed) carrying an incremented count. Read rows are never touched.
  const counts = new Map<string, number>();
  const replacedIds = new Map<string, string[]>();
  if (entry.groupUnread) {
    // Serialise grouping per entity so two concurrent messages cannot both miss each other's unread row.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`notifications:${event.type}:${entity.id}`]);
    const recipientIds = recipients.map((r) => (r.adminId ?? r.customerId) as string);
    const column = audience === 'admins' ? 'admin_id' : 'customer_id';
    const { rows } = await client.query(
      `DELETE FROM notifications
        WHERE ${column} = ANY($1::uuid[]) AND type = $2 AND entity_type = $3 AND entity_id = $4 AND read_at IS NULL
        RETURNING id, ${column} AS recipient_id, COALESCE((data->>'count')::int, 1) AS count`,
      [recipientIds, event.type, entity.type, entity.id]
    );
    for (const row of rows) {
      counts.set(row.recipient_id, (counts.get(row.recipient_id) ?? 0) + row.count);
      replacedIds.set(row.recipient_id, [...(replacedIds.get(row.recipient_id) ?? []), String(row.id)]);
    }
  }

  const columns = {
    adminIds: [] as (string | null)[],
    customerIds: [] as (string | null)[],
    modules: [] as (string | null)[],
    titles: [] as string[],
    bodies: [] as string[],
    data: [] as string[],
  };
  for (const r of recipients) {
    const ctx: RenderContext = { customer, count: (counts.get((r.adminId ?? r.customerId) as string) ?? 0) + 1 };
    const rendered = entry.render(e, ctx);
    columns.adminIds.push(r.adminId);
    columns.customerIds.push(r.customerId);
    columns.modules.push(r.adminId ? entry.module ?? null : null);
    columns.titles.push(rendered.title);
    columns.bodies.push(rendered.body);
    columns.data.push(JSON.stringify(rendered.data));
  }

  const result = await client.query(
    `INSERT INTO notifications
       (admin_id, customer_id, module, title, body, data, type, entity_type, entity_id, actor_type, actor_id, dedupe_key)
     SELECT r.admin_id, r.customer_id, r.module, r.title, r.body, r.data::jsonb, $7, $8, $9, $10, $11, $12
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[])
            AS r(admin_id, customer_id, module, title, body, data)
     ON CONFLICT DO NOTHING
     RETURNING id, admin_id, customer_id`,
    [
      columns.adminIds,
      columns.customerIds,
      columns.modules,
      columns.titles,
      columns.bodies,
      columns.data,
      event.type,
      entity.type,
      entity.id,
      event.actor.type,
      actorId,
      dedupeKey,
    ]
  );
  // Realtime: ids only, on this transaction (delivered on COMMIT). Grouping also tells open tabs which old rows went away.
  const recipientType = audience === 'admins' ? 'admin' : 'customer';
  const events: RealtimeEvent[] = [];
  for (const row of result.rows) {
    const recipientId = (row.admin_id ?? row.customer_id) as string;
    const id = String(row.id);
    events.push({ kind: 'created', recipientType, recipientId, notificationIds: [id] });
    const removed = replacedIds.get(recipientId);
    if (removed && removed.length > 0) {
      events.push({ kind: 'replaced', recipientType, recipientId, notificationIds: [id], replacedIds: removed });
    }
  }
  await publishRealtime(events, client);

  return result.rowCount ?? 0;
}
