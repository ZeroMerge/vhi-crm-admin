"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../../config/db"));
const adminMiddleware_1 = require("../../middleware/adminMiddleware");
const audit_1 = require("../../utils/audit");
const router = (0, express_1.Router)();
// GET /api/admin/communications -> List conversations with adaptive filters
router.get('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { search, filter, sortBy, industry } = req.query;
        let sql = `
      SELECT c.id, c.firstname, c.lastname, c.email, c.industry,
        (SELECT COUNT(*) FROM communications WHERE customer_id = c.id AND is_read = false) as unread_count,
        (SELECT body FROM communications WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM communications WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at
      FROM customers c
      WHERE EXISTS (SELECT 1 FROM communications WHERE customer_id = c.id)
    `;
        const params = [];
        let paramIdx = 1;
        if (filter === 'unread') {
            sql += ` AND EXISTS (SELECT 1 FROM communications WHERE customer_id = c.id AND is_read = false)`;
        }
        if (industry && industry !== 'all') {
            sql += ` AND c.industry = $${paramIdx}`;
            params.push(industry);
            paramIdx++;
        }
        if (search) {
            sql += ` AND (c.firstname ILIKE $${paramIdx} OR c.lastname ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx} OR EXISTS (SELECT 1 FROM communications WHERE customer_id = c.id AND subject ILIKE $${paramIdx}))`;
            params.push(`%${search}%`);
            paramIdx++;
        }
        // Apply sorting
        let orderSql = ' ORDER BY last_message_at DESC'; // default newest
        if (sortBy === 'oldest') {
            orderSql = ' ORDER BY last_message_at ASC';
        }
        sql += orderSql;
        const result = await db_1.default.query(sql, params);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/communications/:customerId
router.get('/:customerId', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query('SELECT * FROM communications WHERE customer_id = $1 ORDER BY created_at ASC', [req.params.customerId]);
        // Mark messages as read since we are opening the thread
        await db_1.default.query('UPDATE communications SET is_read = true WHERE customer_id = $1 AND is_read = false', [req.params.customerId]);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/admin/communications/send
router.post('/send', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { customerId, subject, body } = req.body;
        const result = await db_1.default.query('INSERT INTO communications (customer_id, sent_by, subject, body) VALUES ($1, $2, $3, $4) RETURNING *', [customerId, req.admin.id, subject, body]);
        const comm = result.rows[0];
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'SEND_COMMUNICATION', 'communication', comm.id, { customerId, subject });
        res.json({ success: true, data: comm });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/admin/communications/:messageId
router.delete('/:messageId', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        await db_1.default.query('DELETE FROM communications WHERE id = $1', [req.params.messageId]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'DELETE_COMMUNICATION', 'communication', req.params.messageId);
        res.json({ success: true, message: 'Message deleted' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=communications.routes.js.map