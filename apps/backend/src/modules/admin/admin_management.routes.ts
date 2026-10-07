import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../../config/db';
import { adminMiddleware, requireActiveRole } from '../../middleware/adminMiddleware';
import { requireActiveAdmin } from '../../middleware/permissions';
import { insertAuditEvent, logAuditEvent } from '../../utils/audit';
import { enqueueEmail } from '../email/outbox';
import type { PoolClient } from 'pg';
import { INVITE_PENDING, issueInvite } from './invites';

const router = Router();


router.use(adminMiddleware, requireActiveAdmin);
router.use(requireActiveRole('super_admin'));


router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, assigned_roles, is_active, created_at, last_login_at,
              password_hash = $1 AS "invitePending"
       FROM admins
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC;`,
      [INVITE_PENDING]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

/** Queues the invitation email on the caller's transaction. One group per admin: a resend replaces a still-queued email's token. */
async function queueInviteEmail(client: PoolClient, admin: { id: string; name: string | null; email: string; assigned_roles: string[] | null }, inviterId: string, token: string) {
  const inviter = await client.query('SELECT name FROM admins WHERE id = $1', [inviterId]);
  await enqueueEmail(client, {
    kind: 'admin.invite',
    to: admin.email,
    adminId: admin.id,
    groupKey: `invite:${admin.id}`,
    params: { adminName: admin.name ?? '', inviterName: inviter.rows[0]?.name ?? '', roles: admin.assigned_roles ?? [], token },
  });
}

// Invite (Phase 4): no password is created or returned. The admin gets an email with a single-use link (72 h) to set one.
router.post('/invite', async (req, res, next) => {
  try {
    const { name, email, assignedRoles } = req.body;
    if (!name || !email || !assignedRoles || !Array.isArray(assignedRoles)) {
      return res.status(400).json({ success: false, message: 'Name, email, and assigned roles are required' });
    }

    const checkEmail = await pool.query('SELECT id FROM admins WHERE email = $1', [email]);
    if (checkEmail.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'An admin with this email already exists' });
    }

    // One transaction: the admin, the invitation, the audit row and the email (outbox) exist together or not at all.
    const client = await pool.connect();
    let newAdmin;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO admins (name, email, password_hash, assigned_roles, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id, name, email, assigned_roles, is_active, created_at;`,
        [name, email, INVITE_PENDING, assignedRoles]
      );
      newAdmin = result.rows[0];
      const token = await issueInvite(client, newAdmin.id, req.admin!.id);
      await insertAuditEvent(client, req.admin!.id, 'admin', req.admin!.activeRole, 'INVITE_ADMIN', 'admin', newAdmin.id, { invitedEmail: email, assignedRoles });
      await queueInviteEmail(client, newAdmin, req.admin!.id, token);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      success: true,
      message: `Invitation email sent to ${newAdmin.email}`,
      data: { admin: { ...newAdmin, invitePending: true }, invitePending: true },
    });
  } catch (err) {
    next(err);
  }
});

// Resend: the previous link stops working (revoked) and a new email goes out. Only for admins who haven't accepted yet.
router.post('/:id/resend-invite', async (req, res, next) => {
  try {
    const client = await pool.connect();
    let target;
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id, name, email, assigned_roles, is_active, password_hash = $2 AS pending
           FROM admins WHERE id::text = $1 AND deleted_at IS NULL FOR UPDATE`,
        [req.params.id, INVITE_PENDING]
      );
      target = found.rows[0];
      if (!target) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Admin not found' });
      }
      if (!target.pending) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'This admin has already accepted their invitation' });
      }
      if (target.is_active === false) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'Activate this admin before resending the invitation' });
      }
      const token = await issueInvite(client, target.id, req.admin!.id);
      await insertAuditEvent(client, req.admin!.id, 'admin', req.admin!.activeRole, 'RESEND_ADMIN_INVITE', 'admin', target.id, { invitedEmail: target.email });
      await queueInviteEmail(client, target, req.admin!.id, token);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, message: `A new invitation was sent to ${target.email}; the previous link no longer works.` });
  } catch (err) {
    next(err);
  }
});


router.put('/:id/roles', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedRoles } = req.body;
    if (!assignedRoles || !Array.isArray(assignedRoles)) {
      return res.status(400).json({ success: false, message: 'Assigned roles array is required' });
    }

    // One transaction: role change, audit row and the "access updated" email (outbox).
    const client = await pool.connect();
    let updatedAdmin;
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT assigned_roles FROM admins WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
      if (before.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Admin not found' });
      }
      const result = await client.query(
        `UPDATE admins
         SET assigned_roles = $1
         WHERE id = $2 AND deleted_at IS NULL
         RETURNING id, name, email, assigned_roles, is_active;`,
        [assignedRoles, id]
      );
      updatedAdmin = result.rows[0];
      await insertAuditEvent(client, req.admin!.id, 'admin', req.admin!.activeRole, 'UPDATE_ADMIN_ROLES', 'admin', id, { newRoles: assignedRoles });

      const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((r, i) => r === [...b].sort()[i]);
      if (updatedAdmin.email && !sameSet(before.rows[0].assigned_roles ?? [], updatedAdmin.assigned_roles ?? [])) {
        await enqueueEmail(client, {
          kind: 'admin.roles_changed',
          to: updatedAdmin.email,
          adminId: updatedAdmin.id,
          params: { adminName: updatedAdmin.name ?? '', roles: updatedAdmin.assigned_roles ?? [] },
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, data: updatedAdmin });
  } catch (err) {
    next(err);
  }
});


router.put('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive boolean status is required' });
    }

    
    if (id === req.admin!.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }

    // One transaction: status change, audit row and (on deactivation only) the email (outbox).
    const client = await pool.connect();
    let updatedAdmin;
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT is_active FROM admins WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
      if (before.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Admin not found' });
      }
      const result = await client.query(
        `UPDATE admins
         SET is_active = $1
         WHERE id = $2 AND deleted_at IS NULL
         RETURNING id, name, email, assigned_roles, is_active;`,
        [isActive, id]
      );
      updatedAdmin = result.rows[0];
      await insertAuditEvent(client, req.admin!.id, 'admin', req.admin!.activeRole, 'TOGGLE_ADMIN_STATUS', 'admin', id, { isActive });

      const wasActive = before.rows[0].is_active !== false;
      if (wasActive && isActive === false && updatedAdmin.email) {
        await enqueueEmail(client, {
          kind: 'admin.deactivated',
          to: updatedAdmin.email,
          adminId: updatedAdmin.id,
          params: { adminName: updatedAdmin.name ?? '' },
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, data: updatedAdmin });
  } catch (err) {
    next(err);
  }
});


router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    
    if (id === req.admin!.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
    }

    const result = await pool.query(
      `UPDATE admins
       SET deleted_at = NOW(), is_active = false
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name, email;`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    
    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'DELETE_ADMIN',
      'admin',
      id
    );

    res.json({ success: true, message: 'Admin deleted successfully' });
  } catch (err) {
    next(err);
  }
});


router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    
    const checkAdmin = await pool.query('SELECT id, email FROM admins WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (checkAdmin.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    const { newPassword } = req.body;
    const tempPassword = newPassword || (Math.random().toString(36).slice(-10) + 'A@1');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // One transaction: new hash, audit row and the notice email (outbox). The email never contains the password.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query('UPDATE admins SET password_hash = $1 WHERE id = $2 RETURNING id, name, email', [passwordHash, id]);
      await insertAuditEvent(client, req.admin!.id, 'admin', req.admin!.activeRole, 'RESET_ADMIN_PASSWORD', 'admin', id);
      const target = updated.rows[0];
      if (target?.email) {
        await enqueueEmail(client, {
          kind: 'admin.password_reset_by_admin',
          to: target.email,
          adminId: target.id,
          params: { adminName: target.name ?? '' },
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ 
      success: true, 
      message: 'Password reset successfully.', 
      data: { tempPassword } 
    });
  } catch (err) {
    next(err);
  }
});

export default router;
