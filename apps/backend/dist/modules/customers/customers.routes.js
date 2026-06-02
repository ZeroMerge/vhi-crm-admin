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
function mapCustomer(row) {
    if (!row)
        return null;
    return {
        id: row.id,
        userId: row.user_id,
        firstname: row.firstname,
        lastname: row.lastname,
        email: row.email,
        phone: row.phone,
        industry: row.industry,
        starRating: row.star_rating,
        status: row.status,
        newsletterPrefs: row.newsletter_prefs || [],
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
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
            data: result.rows.map(mapCustomer),
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
        const totalInvoiced = await db_1.default.query('SELECT COALESCE(SUM(amount), 0) as total FROM invoices WHERE customer_id = $1', [req.params.id]);
        const paymentTotal = await db_1.default.query('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE customer_id = $1 AND payment_status = $2', [req.params.id, 'success']);
        const totalInvoicedAmount = parseFloat(totalInvoiced.rows[0].total);
        const totalPaidAmount = parseFloat(paymentTotal.rows[0].total);
        res.json({
            success: true,
            data: {
                ...mapCustomer(result.rows[0]),
                shipmentCount: parseInt(shipmentCount.rows[0].count),
                totalInvoiced: totalInvoicedAmount,
                totalPaid: totalPaidAmount,
                outstandingBalance: Math.max(totalInvoicedAmount - totalPaidAmount, 0),
            },
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
        res.json({ success: true, data: mapCustomer(result.rows[0]) });
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
        res.json({ success: true, data: mapCustomer(result.rows[0]) });
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
        res.json({ success: true, data: mapCustomer(result.rows[0]) });
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
        // Map shipments if needed
        const mapped = result.rows.map(row => ({
            id: row.id,
            orderId: row.order_id,
            customerId: row.customer_id,
            shippingMode: row.shipping_mode,
            deliveryMode: row.delivery_mode,
            natureOfItem: row.nature_of_item,
            invoiceValue: parseFloat(row.invoice_value),
            invoiceCurrency: row.invoice_currency,
            weight: parseFloat(row.weight),
            weightUnit: row.weight_unit || 'kg',
            originAddress: row.origin_address,
            destinationAddress: row.destination_address,
            status: row.status,
            isDraft: row.is_draft,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
        res.json({ success: true, data: mapped });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/customers/:id/payments
router.get('/:id/payments', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query('SELECT * FROM payments WHERE customer_id = $1 ORDER BY created_at DESC', [req.params.id]);
        const mapped = result.rows.map(row => ({
            id: row.id,
            invoiceId: row.invoice_id,
            customerId: row.customer_id,
            amount: parseFloat(row.amount),
            currency: row.currency,
            paymentMethod: row.payment_method,
            paymentStatus: row.payment_status,
            gatewayReference: row.gateway_reference,
            receiptUrl: row.receipt_url,
            paidAt: row.paid_at,
            createdAt: row.created_at,
        }));
        res.json({ success: true, data: mapped });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=customers.routes.js.map