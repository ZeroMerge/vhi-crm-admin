import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../../config/db';
import { adminMiddleware, requireActiveRole } from '../../middleware/adminMiddleware';
import { logAuditEvent } from '../../utils/audit';

const router = Router();


router.use(adminMiddleware);
router.use(requireActiveRole('super_admin'));


router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, assigned_roles, is_active, created_at, last_login_at
       FROM admins
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC;`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});


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

    
    const tempPassword = Math.random().toString(36).slice(-10) + 'A@1';
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const result = await pool.query(
      `INSERT INTO admins (name, email, password_hash, assigned_roles, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, email, assigned_roles, is_active, created_at;`,
      [name, email, passwordHash, assignedRoles]
    );

    const newAdmin = result.rows[0];

    
    await logAuditEvent(
      req.admin!.id,
      req.admin!.activeRole,
      'INVITE_ADMIN',
      'admin',
      newAdmin.id,
      { invitedEmail: email, assignedRoles }
    );

    res.status(201).json({
      success: true,
      message: 'Admin invited successfully. An email invitation has been sent.',
      data: {
        admin: newAdmin,
        inviteLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/setup-password?token=${newAdmin.id}`,
        tempPassword 
      }
    });
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

    const result = await pool.query(
      `UPDATE admins
       SET assigned_roles = $1
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, name, email, assigned_roles, is_active;`,
      [assignedRoles, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    const updatedAdmin = result.rows[0];

    
    await logAuditEvent(
      req.admin!.id,
      req.admin!.activeRole,
      'UPDATE_ADMIN_ROLES',
      'admin',
      id,
      { newRoles: assignedRoles }
    );

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

    const result = await pool.query(
      `UPDATE admins
       SET is_active = $1
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, name, email, assigned_roles, is_active;`,
      [isActive, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    const updatedAdmin = result.rows[0];

    
    await logAuditEvent(
      req.admin!.id,
      req.admin!.activeRole,
      'TOGGLE_ADMIN_STATUS',
      'admin',
      id,
      { isActive }
    );

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

    await pool.query(
      'UPDATE admins SET password_hash = $1 WHERE id = $2',
      [passwordHash, id]
    );

    
    await logAuditEvent(
      req.admin!.id,
      req.admin!.activeRole,
      'RESET_ADMIN_PASSWORD',
      'admin',
      id
    );

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
