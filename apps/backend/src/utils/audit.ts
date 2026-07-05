import pool from '../config/db';

export async function logAuditEvent(
  actorId: string,
  actorType: 'admin' | 'customer',
  activeRole: string | null,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  metadata?: any
) {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (admin_id, customer_id, actor_type, active_role, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actorType === 'admin'    ? actorId : null,
        actorType === 'customer' ? actorId : null,
        actorType,
        activeRole,
        action,
        resourceType,
        resourceId || null,
        metadata ? JSON.stringify(metadata) : '{}',
      ]
    );
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}
