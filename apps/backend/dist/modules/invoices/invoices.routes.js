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
function mapInvoice(row) {
    if (!row)
        return null;
    return {
        id: row.id,
        invoiceNumber: row.invoice_number,
        shipmentId: row.shipment_id,
        customerId: row.customer_id,
        amount: parseFloat(row.amount),
        currency: row.currency,
        status: row.status,
        dueDate: row.due_date,
        followUpDate: row.follow_up_date,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        customer: row.customer_id ? {
            id: row.customer_id,
            firstname: row.firstname || row.customer_firstname,
            lastname: row.lastname || row.customer_lastname,
            email: row.email || row.customer_email,
            phone: row.phone || row.customer_phone,
        } : null,
        shipment: row.shipment_id ? {
            id: row.shipment_id,
            orderId: row.shipment_order_id || row.order_id,
            status: row.shipment_status || row.status,
        } : null,
    };
}
// GET /api/admin/invoices
router.get('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { status, currency, customerId, search, dateFrom, dateTo, overdue, sortBy, page = '1', pageSize = '10' } = req.query;
        let sql = 'SELECT i.*, c.firstname, c.lastname, c.email, s.order_id as shipment_order_id FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id LEFT JOIN shipments s ON i.shipment_id = s.id WHERE 1=1';
        const params = [];
        let paramIdx = 1;
        if (status && status !== 'all') {
            sql += ` AND i.status = $${paramIdx}`;
            params.push(status);
            paramIdx++;
        }
        if (currency && currency !== 'all') {
            sql += ` AND i.currency = $${paramIdx}`;
            params.push(currency);
            paramIdx++;
        }
        if (customerId) {
            sql += ` AND i.customer_id = $${paramIdx}`;
            params.push(customerId);
            paramIdx++;
        }
        if (dateFrom) {
            sql += ` AND i.created_at >= $${paramIdx}`;
            params.push(dateFrom);
            paramIdx++;
        }
        if (dateTo) {
            sql += ` AND i.created_at <= $${paramIdx}`;
            params.push(dateTo);
            paramIdx++;
        }
        if (overdue === 'true') {
            sql += ` AND i.due_date < CURRENT_DATE AND i.status != 'paid'`;
        }
        if (search) {
            sql += ` AND (i.invoice_number ILIKE $${paramIdx} OR c.firstname ILIKE $${paramIdx} OR c.lastname ILIKE $${paramIdx})`;
            params.push(`%${search}%`);
            paramIdx++;
        }
        const countResult = await db_1.default.query(`SELECT COUNT(*) FROM (${sql}) AS count_query`, params);
        const total = parseInt(countResult.rows[0].count);
        // Apply sorting
        let orderSql = ' ORDER BY i.created_at DESC'; // default newest
        if (sortBy === 'oldest') {
            orderSql = ' ORDER BY i.created_at ASC';
        }
        else if (sortBy === 'amount-high-low' || sortBy === 'amount_desc') {
            orderSql = ' ORDER BY i.amount DESC';
        }
        else if (sortBy === 'amount-low-high' || sortBy === 'amount_asc') {
            orderSql = ' ORDER BY i.amount ASC';
        }
        sql += orderSql;
        sql += ` LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
        params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
        const result = await db_1.default.query(sql, params);
        res.json({
            success: true,
            data: result.rows.map(mapInvoice),
            pagination: { total, page: parseInt(page), pageSize: parseInt(pageSize), totalPages: Math.ceil(total / parseInt(pageSize)) },
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/invoices/:id
router.get('/:id', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const invoiceResult = await db_1.default.query(`SELECT i.*, 
              c.firstname as customer_firstname, c.lastname as customer_lastname, c.email as customer_email, c.phone as customer_phone,
              s.order_id as shipment_order_id, s.status as shipment_status
       FROM invoices i 
       LEFT JOIN customers c ON i.customer_id = c.id 
       LEFT JOIN shipments s ON i.shipment_id = s.id 
       WHERE i.id = $1`, [req.params.id]);
        if (invoiceResult.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        const payments = await db_1.default.query('SELECT * FROM payments WHERE invoice_id = $1', [req.params.id]);
        const mappedPayments = payments.rows.map(row => ({
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
        res.json({ success: true, data: { ...mapInvoice(invoiceResult.rows[0]), payments: mappedPayments } });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/admin/invoices
router.post('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { customerId, shipmentId, amount, currency, dueDate, notes } = req.body;
        const invoiceNumber = `INV-${Date.now()}`;
        const result = await db_1.default.query('INSERT INTO invoices (invoice_number, shipment_id, customer_id, amount, currency, due_date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [invoiceNumber, shipmentId, customerId, amount, currency || 'NGN', dueDate, notes]);
        const invoice = result.rows[0];
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'CREATE_INVOICE', 'invoice', invoice.id, { amount, currency, invoiceNumber });
        res.json({ success: true, data: mapInvoice(invoice) });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/invoices/:id/status
router.put('/:id/status', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { status } = req.body;
        await db_1.default.query('UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
        const result = await db_1.default.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPDATE_INVOICE_STATUS', 'invoice', req.params.id, { status });
        res.json({ success: true, data: mapInvoice(result.rows[0]) });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/invoices/:id/reminder
router.put('/:id/reminder', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { followUpDate } = req.body;
        await db_1.default.query('UPDATE invoices SET follow_up_date = $1, updated_at = NOW() WHERE id = $2', [followUpDate || null, req.params.id]);
        const result = await db_1.default.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPDATE_INVOICE_REMINDER', 'invoice', req.params.id, { followUpDate });
        res.json({ success: true, data: mapInvoice(result.rows[0]) });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/invoices/:id/payment
router.put('/:id/payment', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { amount, paymentMethod, notes } = req.body;
        const invoice = await db_1.default.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
        if (invoice.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        const result = await db_1.default.query('INSERT INTO payments (invoice_id, customer_id, amount, currency, payment_method, payment_status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [req.params.id, invoice.rows[0].customer_id, amount, invoice.rows[0].currency, paymentMethod, 'success']);
        await db_1.default.query('UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2', ['paid', req.params.id]);
        const updatedInvoiceResult = await db_1.default.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'RECORD_INVOICE_PAYMENT', 'invoice', req.params.id, { amount, paymentMethod, notes });
        res.json({ success: true, data: updatedInvoiceResult.rows[0] });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/invoices/:id/pdf
router.get('/:id/pdf', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${req.params.id}.pdf`);
        res.send('PDF content placeholder');
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/admin/invoices/:id
router.delete('/:id', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        await db_1.default.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'DELETE_INVOICE', 'invoice', req.params.id);
        res.json({ success: true, message: 'Invoice deleted' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=invoices.routes.js.map