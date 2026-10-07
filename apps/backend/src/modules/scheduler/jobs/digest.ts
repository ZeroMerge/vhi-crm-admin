// Shared by the daily digest jobs: who gets a digest today.
import type { PoolClient } from 'pg';

/** Rows listed in one digest email; the rest are counted ("+N more in the admin portal"). */
export const DIGEST_MAX_ROWS = 50;

export interface DigestRecipient {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Active, non-deleted admins with one of `roles` whose preference is on, excluding anyone who already has a digest email for this
 * date (a row with their group key, whatever its status). That makes a second run on the same date queue nothing.
 */
export async function digestRecipients(
  client: PoolClient,
  options: { roles: string[]; groupKeyPrefix: string; wants: (prefs: unknown) => boolean }
): Promise<DigestRecipient[]> {
  const { rows } = await client.query(
    `SELECT a.id, a.name, a.email, a.notification_prefs
       FROM admins a
      WHERE a.is_active IS NOT FALSE AND a.deleted_at IS NULL
        AND a.assigned_roles && $1::text[]
        AND a.email IS NOT NULL AND a.email <> ''
        AND NOT EXISTS (SELECT 1 FROM email_deliveries d WHERE d.group_key = $2 || a.id::text)
      ORDER BY a.id`,
    [options.roles, options.groupKeyPrefix]
  );
  return rows.filter((r) => options.wants(r.notification_prefs)).map((r) => ({ id: r.id, name: r.name, email: r.email }));
}
