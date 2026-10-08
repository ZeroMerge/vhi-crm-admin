// Admin invitations (Phase 4, replaces the temporary password; RISKS R-30). The token is 32 random bytes (base64url), sent only
// in the invite email and never stored: admin_invites keeps its SHA-256. An invited admin's password_hash is the sentinel below
// (not a bcrypt hash, so no password can match it) until the invitation is accepted.
import crypto from 'crypto';
import type { PoolClient } from 'pg';

export const INVITE_PENDING = '!invite-pending';
export const INVITE_TTL_HOURS = 72;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const isInviteTokenShape = (token: unknown): token is string => typeof token === 'string' && TOKEN_PATTERN.test(token);
export const hashInviteToken = (token: string): Buffer => crypto.createHash('sha256').update(token, 'utf8').digest();

/** Revokes the admin's open invitation (if any) and creates a new one. Returns the token, for the email only. */
export async function issueInvite(client: PoolClient, adminId: string, createdBy: string | null): Promise<string> {
  await client.query('UPDATE admin_invites SET revoked_at = NOW() WHERE admin_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [adminId]);
  const token = crypto.randomBytes(32).toString('base64url');
  await client.query(
    `INSERT INTO admin_invites (admin_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, NOW() + make_interval(hours => $3), $4)`,
    [adminId, hashInviteToken(token), INVITE_TTL_HOURS, createdBy]
  );
  return token;
}

export type InviteState =
  | { state: 'valid'; inviteId: string; adminId: string; email: string; name: string | null }
  | { state: 'invalid' }
  | { state: 'expired' };

/**
 * Looks an invitation up by token. Used, revoked (a newer one was sent), unknown, and invitations whose admin was deleted,
 * deactivated or already has a password are all 'invalid'. With `lock`, the invite and admin rows are locked (accept).
 */
export async function findInvite(client: PoolClient, token: unknown, lock = false): Promise<InviteState> {
  if (!isInviteTokenShape(token)) return { state: 'invalid' };
  const { rows } = await client.query(
    `SELECT i.id::text AS invite_id, i.expires_at <= NOW() AS expired, i.used_at, i.revoked_at,
            a.id AS admin_id, a.email, a.name, a.deleted_at, a.is_active, a.password_hash = $2 AS pending
       FROM admin_invites i
       JOIN admins a ON a.id = i.admin_id
      WHERE i.token_hash = $1
      ${lock ? 'FOR UPDATE OF i, a' : ''}`,
    [hashInviteToken(token), INVITE_PENDING]
  );
  const r = rows[0];
  if (!r || r.used_at || r.revoked_at || r.deleted_at || r.is_active === false || !r.pending) return { state: 'invalid' };
  if (r.expired) return { state: 'expired' };
  return { state: 'valid', inviteId: r.invite_id, adminId: r.admin_id, email: r.email, name: r.name };
}

export const INVITE_MESSAGES = {
  invalid: 'This invitation link is invalid or has already been used.',
  expired: 'This invitation has expired. Ask a super admin to send a new one.',
} as const;
