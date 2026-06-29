"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = __importDefault(require("../../config/db"));
const adminMiddleware_1 = require("../../middleware/adminMiddleware");
const audit_1 = require("../../utils/audit");
const router = (0, express_1.Router)();
// Apply super_admin requirement globally to this router
router.use(adminMiddleware_1.adminMiddleware);
router.use((0, adminMiddleware_1.requireActiveRole)('super_admin'));
// GET /api/admin/admins -> List all admins
router.get('/', async (req, res, next) => {
    try {
        const result = await db_1.default.query(`SELECT id, name, email, assigned_roles, is_active, created_at, last_login_at
       FROM admins
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC;`);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/admin/admins/invite -> Invite new admin
router.post('/invite', async (req, res, next) => {
    try {
        const { name, email, assignedRoles } = req.body;
        if (!name || !email || !assignedRoles || !Array.isArray(assignedRoles)) {
            return res.status(400).json({ success: false, message: 'Name, email, and assigned roles are required' });
        }
        // Check if email already exists
        const checkEmail = await db_1.default.query('SELECT id FROM admins WHERE email = $1', [email]);
        if (checkEmail.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'An admin with this email already exists' });
        }
        // Generate a temporary password (since they will get an invite set-password link)
        const tempPassword = Math.random().toString(36).slice(-10) + 'A@1';
        const passwordHash = await bcryptjs_1.default.hash(tempPassword, 10);
        const result = await db_1.default.query(`INSERT INTO admins (name, email, password_hash, assigned_roles, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, email, assigned_roles, is_active, created_at;`, [name, email, passwordHash, assignedRoles]);
        const newAdmin = result.rows[0];
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'INVITE_ADMIN', 'admin', newAdmin.id, { invitedEmail: email, assignedRoles });
        res.status(201).json({
            success: true,
            message: 'Admin invited successfully. An email invitation has been sent.',
            data: {
                admin: newAdmin,
                inviteLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/setup-password?token=${newAdmin.id}`,
                tempPassword // included for convenience in testing/local dev
            }
        });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/admins/:id/roles -> Update admin roles
router.put('/:id/roles', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { assignedRoles } = req.body;
        if (!assignedRoles || !Array.isArray(assignedRoles)) {
            return res.status(400).json({ success: false, message: 'Assigned roles array is required' });
        }
        const result = await db_1.default.query(`UPDATE admins
       SET assigned_roles = $1
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, name, email, assigned_roles, is_active;`, [assignedRoles, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        const updatedAdmin = result.rows[0];
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPDATE_ADMIN_ROLES', 'admin', id, { newRoles: assignedRoles });
        res.json({ success: true, data: updatedAdmin });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/admins/:id/status -> Toggle admin active status
router.put('/:id/status', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ success: false, message: 'isActive boolean status is required' });
        }
        // Prevent deactivating oneself
        if (id === req.admin.id) {
            return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
        }
        const result = await db_1.default.query(`UPDATE admins
       SET is_active = $1
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, name, email, assigned_roles, is_active;`, [isActive, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        const updatedAdmin = result.rows[0];
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'TOGGLE_ADMIN_STATUS', 'admin', id, { isActive });
        res.json({ success: true, data: updatedAdmin });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/admin/admins/:id -> Soft delete admin
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        // Prevent deleting oneself
        if (id === req.admin.id) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
        }
        const result = await db_1.default.query(`UPDATE admins
       SET deleted_at = NOW(), is_active = false
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name, email;`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'DELETE_ADMIN', 'admin', id);
        res.json({ success: true, message: 'Admin deleted successfully' });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/admin/admins/:id/reset-password -> Reset admin password
router.post('/:id/reset-password', async (req, res, next) => {
    try {
        const { id } = req.params;
        // Check if admin exists
        const checkAdmin = await db_1.default.query('SELECT id, email FROM admins WHERE id = $1 AND deleted_at IS NULL', [id]);
        if (checkAdmin.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin not found' });
        }
        const { newPassword } = req.body;
        const tempPassword = newPassword || (Math.random().toString(36).slice(-10) + 'A@1');
        const passwordHash = await bcryptjs_1.default.hash(tempPassword, 10);
        await db_1.default.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'RESET_ADMIN_PASSWORD', 'admin', id);
        res.json({
            success: true,
            message: 'Password reset successfully.',
            data: { tempPassword }
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=admin_management.routes.js.map