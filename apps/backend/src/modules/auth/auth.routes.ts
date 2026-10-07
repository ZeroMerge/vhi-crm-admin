import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { requireActiveAdmin } from '../../middleware/permissions';
import { insertAuditEvent, logAuditEvent } from '../../utils/audit';
import { enqueueEmail } from '../email/outbox';
import { ADMIN_EMAIL_PREF_KEYS, adminPrefsUpdateSchema, normaliseAdminPrefs } from '../email/preferences';

const router = Router();


router.post('/admin/verify-email', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email required' });
    }

    const result = await pool.query('SELECT assigned_roles FROM admins WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Email not found' });
    }

    const admin = result.rows[0];
    const assignedRoles = admin.assigned_roles || [];
    
    if (assignedRoles.length === 0) {
      return res.status(403).json({ success: false, message: 'Registered role not attached' });
    }

    res.json({ success: true, message: 'Email verified' });
  } catch (err) {
    next(err);
  }
});


router.post('/admin/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    console.log('[DEBUG] Login attempt received:', { email, passwordLength: password ? password.length : 0 });
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
    // Inactive or deleted accounts get the same answer as a wrong password (no account-state disclosure).
    if (valid && (admin.is_active === false || admin.deleted_at)) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    console.log('[DEBUG] Password bcrypt comparison result:', valid);
    if (!valid) {
      console.log('[DEBUG] Password hash mismatch');
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const assignedRoles = admin.assigned_roles || [];
    if (assignedRoles.length === 0) {
      return res.status(403).json({ success: false, message: 'Registered role not attached' });
    }

    
    let activeRole = admin.last_active_role;
    if (!activeRole || !assignedRoles.includes(activeRole)) {
      activeRole = assignedRoles[0];
    }

    
    await pool.query(
      'UPDATE admins SET last_login_at = NOW(), last_active_role = $1 WHERE id = $2',
      [activeRole, admin.id]
    );

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

    
    await logAuditEvent(admin.id, 'admin', activeRole, 'LOGIN', 'admin', admin.id, { activeRole });

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


router.post('/admin/switch-role', adminMiddleware, requireActiveAdmin, async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ success: false, message: 'Role parameter required' });
    }

    const adminId = req.admin!.id;
    const email = req.admin!.email;

    
    const result = await pool.query('SELECT * FROM admins WHERE id = $1', [adminId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    const admin = result.rows[0];
    const assignedRoles = admin.assigned_roles || ['support_staff'];

    if (!assignedRoles.includes(role)) {
      return res.status(403).json({ success: false, message: 'Role is not assigned to this account' });
    }

    
    await pool.query('UPDATE admins SET last_active_role = $1 WHERE id = $2', [role, adminId]);

    
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

    
    await logAuditEvent(adminId, 'admin', role, 'SWITCH_ROLE', 'admin', adminId, { previousRole: req.admin!.activeRole, newRole: role });

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


router.get('/admin/me', adminMiddleware, requireActiveAdmin, async (req, res, next) => {
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


router.post('/admin/logout', adminMiddleware, requireActiveAdmin, async (req, res, next) => {
  try {
    if (req.admin) {
      await logAuditEvent(req.admin.id, 'admin', req.admin.activeRole, 'LOGOUT', 'admin', req.admin.id);
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});


router.put('/admin/change-password', adminMiddleware, requireActiveAdmin, async (req, res, next) => {
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
    // One transaction: new hash, audit row and the "password changed" notice (outbox).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, adminId]);
      await insertAuditEvent(client, adminId, 'admin', activeRole, 'CHANGE_PASSWORD', 'admin', adminId);
      const me = result.rows[0];
      if (me.email) {
        await enqueueEmail(client, { kind: 'admin.password_changed', to: me.email, adminId, params: { adminName: me.name ?? '' } });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});


router.put('/admin/profile', adminMiddleware, requireActiveAdmin, async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    const adminId = req.admin!.id;
    const activeRole = req.admin!.activeRole;

    await pool.query('UPDATE admins SET name = $1 WHERE id = $2', [name, adminId]);
    
    
    await logAuditEvent(adminId, 'admin', activeRole, 'UPDATE_PROFILE', 'admin', adminId, { name, phone });

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    next(err);
  }
});


// Saved email preferences, normalised (unreadable values fall back to the defaults the Settings page has always shown).
// emailKeys = the keys that currently gate an email; the others are stored for later phases.
router.get('/admin/notification-preferences', adminMiddleware, requireActiveAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT notification_prefs FROM admins WHERE id = $1', [req.admin!.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Admin not found' });
    res.json({ success: true, data: { prefs: normaliseAdminPrefs(rows[0].notification_prefs), emailKeys: ADMIN_EMAIL_PREF_KEYS } });
  } catch (err) {
    next(err);
  }
});

// Body { notificationPrefs: { <known key>: boolean, ... } }. Unknown keys or non-boolean values → 400.
// Merged into the saved preferences (a partial update never resets the other keys).
router.put('/admin/notification-preferences', adminMiddleware, requireActiveAdmin, async (req, res, next) => {
  const parsed = adminPrefsUpdateSchema.safeParse(req.body?.notificationPrefs);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid notification preferences', errors: parsed.error.flatten() });
  }
  const client = await pool.connect().catch((err) => {
    next(err);
    return null;
  });
  if (!client) return;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT notification_prefs FROM admins WHERE id = $1 FOR UPDATE', [req.admin!.id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    const prefs = { ...normaliseAdminPrefs(rows[0].notification_prefs), ...parsed.data };
    await client.query('UPDATE admins SET notification_prefs = $1 WHERE id = $2', [JSON.stringify(prefs), req.admin!.id]);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Notification preferences updated successfully', data: { prefs, emailKeys: ADMIN_EMAIL_PREF_KEYS } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

export default router;
