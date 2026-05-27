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
// GET /api/admin/customers
router.get('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { search, industry, star, status, sortBy, page = '1', pageSize = '10' } = req.query;
        let sql = 'SELECT * FROM customers WHERE 1=1';
        const params = [];
        let paramIdx = 1;
        if (search) {
            sql += ` AND (firstname ILIKE $${paramIdx} OR lastname ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR user_id ILIKE $${paramIdx})`;
            params.push(`%${search}%`);
            paramIdx++;
        }
        if (industry && industry !== 'all') {
            sql += ` AND industry = $${paramIdx}`;
            params.push(industry);
            paramIdx++;
        }
        if (star && star !== 'all') {
            sql += ` AND star_rating = $${paramIdx}`;
            params.push(parseInt(star));
            paramIdx++;
        }
        if (status && status !== 'all') {
            sql += ` AND status = $${paramIdx}`;
            params.push(status);
            paramIdx++;
        }
        const countResult = await db_1.default.query(`SELECT COUNT(*) FROM (${sql}) AS count_query`, params);
        const total = parseInt(countResult.rows[0].count);
        // Apply sorting
        let orderSql = ' ORDER BY created_at DESC'; // default Newest
        if (sortBy === 'oldest') {
            orderSql = ' ORDER BY created_at ASC';
        }
        else if (sortBy === 'name-a-z' || sortBy === 'name_asc') {
            orderSql = ' ORDER BY firstname ASC, lastname ASC';
        }
        else if (sortBy === 'name-z-a' || sortBy === 'name_desc') {
            orderSql = ' ORDER BY firstname DESC, lastname DESC';
        }
        else if (sortBy === 'star-high-low' || sortBy === 'star_desc') {
            orderSql = ' ORDER BY star_rating DESC';
        }
        sql += orderSql;
        sql += ` LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
        params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
        const result = await db_1.default.query(sql, params);
        res.json({
            success: true,
            data: result.rows,
            pagination: { total, page: parseInt(page), pageSize: parseInt(pageSize), totalPages: Math.ceil(total / parseInt(pageSize)) },
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/customers/:id
router.get('/:id', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Customer not found' });
        const shipmentCount = await db_1.default.query('SELECT COUNT(*) FROM shipments WHERE customer_id = $1', [req.params.id]);
        const paymentTotal = await db_1.default.query('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE customer_id = $1 AND payment_status = $2', [req.params.id, 'success']);
        res.json({
            success: true,
            data: { ...result.rows[0], shipmentCount: parseInt(shipmentCount.rows[0].count), paymentTotal: parseFloat(paymentTotal.rows[0].total) },
        });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/customers/:id/star
router.put('/:id/star', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { starRating } = req.body;
        await db_1.default.query('UPDATE customers SET star_rating = $1 WHERE id = $2', [starRating, req.params.id]);
        const result = await db_1.default.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPDATE_CUSTOMER_STAR', 'customer', req.params.id, { starRating });
        res.json({ success: true, data: result.rows[0] });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/customers/:id/status
router.put('/:id/status', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { status } = req.body;
        await db_1.default.query('UPDATE customers SET status = $1 WHERE id = $2', [status, req.params.id]);
        const result = await db_1.default.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPDATE_CUSTOMER_STATUS', 'customer', req.params.id, { status });
        res.json({ success: true, data: result.rows[0] });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/customers/:id/segment
router.put('/:id/segment', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { industry } = req.body;
        await db_1.default.query('UPDATE customers SET industry = $1 WHERE id = $2', [industry, req.params.id]);
        const result = await db_1.default.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPDATE_CUSTOMER_SEGMENT', 'customer', req.params.id, { industry });
        res.json({ success: true, data: result.rows[0] });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/admin/customers/:id
router.delete('/:id', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        await db_1.default.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'DELETE_CUSTOMER', 'customer', req.params.id);
        res.json({ success: true, message: 'Customer deleted' });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/customers/:id/shipments
router.get('/:id/shipments', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query('SELECT * FROM shipments WHERE customer_id = $1 ORDER BY created_at DESC', [req.params.id]);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/customers/:id/payments
router.get('/:id/payments', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query('SELECT * FROM payments WHERE customer_id = $1 ORDER BY created_at DESC', [req.params.id]);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=customers.routes.js.map