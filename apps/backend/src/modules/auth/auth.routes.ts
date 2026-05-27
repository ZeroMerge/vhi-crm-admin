import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { logAuditEvent } from '../../utils/audit';

const router = Router();

// POST /api/auth/admin/login
router.post('/admin/login', async (req, res, next) => {
  try {
    const { email, password, selectedRole } = req.body;
    console.log('[DEBUG] Login attempt received:', { email, passwordLength: password ? password.length : 0, selectedRole });
    if (!email || !password) {
      console.log('[DEBUG] Missing email or password');
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const result = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
    console.log('[DEBUG] Query result rows count:', result.rows.length);
    if (result.rows.length === 0) {
      console.log('[DEBUG] Admin email not found in database');
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    console.log('[DEBUG] Password bcrypt comparison result:', valid);
    if (!valid) {
      console.log('[DEBUG] Password hash mismatch');
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const assignedRoles = admin.assigned_roles || ['support_staff'];

    // If the account has multiple roles and they haven't picked one, return role selection trigger
    if (assignedRoles.length > 1 && !selectedRole) {
      return res.json({
        success: true,
        data: {
          requiresRoleSelection: true,
          assignedRoles,
          admin: { id: admin.id, name: admin.name, email: admin.email }
        }
      });
    }

    // Determine the active role
    let activeRole = assignedRoles[0];
    if (selectedRole) {
      if (!assignedRoles.includes(selectedRole)) {
        return res.status(400).json({ success: false, message: 'Invalid selected role for this admin' });
      }
      activeRole = selectedRole;
    }

    const token = jwt.sign(
      {
        id: admin.id,
        adminId: admin.id,
        email: admin.email,
        activeRole,
        assignedRoles
      },
      process.env.ADMIN_JWT_SECRET || 'fallback_secret',
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
    );

    // Audit log login
    await logAuditEvent(admin.id, activeRole, 'LOGIN', 'admin', admin.id, { activeRole });

    res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          activeRole,
          assignedRoles,
          notificationPrefs: admin.notification_prefs
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/admin/switch-role
router.post('/admin/switch-role', adminMiddleware, async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ success: false, message: 'Role parameter required' });
    }

    const adminId = req.admin!.id;
    const email = req.admin!.email;

    // Fetch the latest assigned roles from the database to make sure it's accurate
    const result = await pool.query('SELECT * FROM admins WHERE id = $1', [adminId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    const admin = result.rows[0];
    const assignedRoles = admin.assigned_roles || ['support_staff'];

    if (!assignedRoles.includes(role)) {
      return res.status(403).json({ success: false, message: 'Role is not assigned to this account' });
    }

    // Generate new JWT
    const token = jwt.sign(
      {
        id: adminId,
        adminId,
        email,
        activeRole: role,
        assignedRoles
      },
      process.env.ADMIN_JWT_SECRET || 'fallback_secret',
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
    );

    // Audit log role switch
    await logAuditEvent(adminId, role, 'SWITCH_ROLE', 'admin', adminId, { previousRole: req.admin!.activeRole, newRole: role });

    res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          activeRole: role,
          assignedRoles,
          notificationPrefs: admin.notification_prefs
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/admin/me
router.get('/admin/me', adminMiddleware, async (req, res, next) => {
  try {
    const adminId = req.admin!.id;
    const result = await pool.query('SELECT id, name, email, assigned_roles, notification_prefs FROM admins WHERE id = $1', [adminId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    const admin = result.rows[0];
    res.json({
      success: true,
      data: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        activeRole: req.admin!.activeRole,
        assignedRoles: admin.assigned_roles,
        notificationPrefs: admin.notification_prefs
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/admin/logout
router.post('/admin/logout', adminMiddleware, async (req, res, next) => {
  try {
    if (req.admin) {
      await logAuditEvent(req.admin.id, req.admin.activeRole, 'LOGOUT', 'admin', req.admin.id);
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/admin/change-password
router.put('/admin/change-password', adminMiddleware, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const adminId = req.admin!.id;
    const activeRole = req.admin!.activeRole;

    const result = await pool.query('SELECT * FROM admins WHERE id = $1', [adminId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, adminId]);

    // Audit log password update
    await logAuditEvent(adminId, activeRole, 'CHANGE_PASSWORD', 'admin', adminId);

    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/admin/profile
router.put('/admin/profile', adminMiddleware, async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    const adminId = req.admin!.id;
    const activeRole = req.admin!.activeRole;

    await pool.query('UPDATE admins SET name = $1 WHERE id = $2', [name, adminId]);
    
    // Audit log profile update
    await logAuditEvent(adminId, activeRole, 'UPDATE_PROFILE', 'admin', adminId, { name, phone });

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/admin/notification-preferences
router.put('/admin/notification-preferences', adminMiddleware, async (req, res, next) => {
  try {
    const { notificationPrefs } = req.body;
    const adminId = req.admin!.id;
    const activeRole = req.admin!.activeRole;

    await pool.query('UPDATE admins SET notification_prefs = $1 WHERE id = $2', [JSON.stringify(notificationPrefs), adminId]);

    res.json({ success: true, message: 'Notification preferences updated successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
