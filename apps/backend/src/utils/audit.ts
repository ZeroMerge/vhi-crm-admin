import pool from '../config/db';

export async function logAuditEvent(
  adminId: string,
  activeRole: string,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  metadata?: any
) {
  try {
    const queryText = `
      INSERT INTO audit_logs (admin_id, active_role, action, resource_type, resource_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id;
    `;
    const params = [
      adminId,
      activeRole,
      action,
      resourceType,
      resourceId || null,
      metadata ? JSON.stringify(metadata) : '{}'
    ];
    
    await pool.query(queryText, params);
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}
