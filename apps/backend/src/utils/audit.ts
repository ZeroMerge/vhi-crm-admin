import type { PoolClient } from 'pg';
import pool from '../config/db';

type AuditActorType = 'admin' | 'customer';

function auditParams(
  actorId: string,
  actorType: AuditActorType,
  activeRole: string | null,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  metadata?: any
) {
  return [
    actorType === 'admin'    ? actorId : null,
    actorType === 'customer' ? actorId : null,
    actorType,
    activeRole,
    action,
    resourceType,
    resourceId || null,
    metadata ? JSON.stringify(metadata) : '{}',
  ];
}

const AUDIT_INSERT = `INSERT INTO audit_logs
         (admin_id, customer_id, actor_type, active_role, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

// Best effort, outside any transaction: failures are logged and swallowed.
export async function logAuditEvent(
  actorId: string,
  actorType: AuditActorType,
  activeRole: string | null,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  metadata?: any
) {
  try {
    await pool.query(AUDIT_INSERT, auditParams(actorId, actorType, activeRole, action, resourceType, resourceId, metadata));
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}

// Inside the caller's transaction: a failure throws (so the whole action rolls back) and the new row's id
// is returned so rows written in the same transaction (e.g. notification dedupe keys) can reference it.
export async function insertAuditEvent(
  client: PoolClient,
  actorId: string,
  actorType: AuditActorType,
  activeRole: string | null,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  metadata?: any
): Promise<string> {
  const { rows } = await client.query(
    `${AUDIT_INSERT} RETURNING id`,
    auditParams(actorId, actorType, activeRole, action, resourceType, resourceId, metadata)
  );
  return rows[0].id;
}
