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
// GET /api/admin/shipments
router.get('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { status, mode, customerId, search, dateFrom, dateTo, sortBy, page = '1', pageSize = '10' } = req.query;
        let sql = 'SELECT s.*, c.firstname, c.lastname, c.email, c.phone, c.industry FROM shipments s LEFT JOIN customers c ON s.customer_id = c.id WHERE 1=1';
        const params = [];
        let paramIdx = 1;
        if (status && status !== 'all') {
            sql += ` AND s.status = $${paramIdx}`;
            params.push(status);
            paramIdx++;
        }
        if (mode && mode !== 'all') {
            sql += ` AND s.shipping_mode = $${paramIdx}`;
            params.push(mode);
            paramIdx++;
        }
        if (customerId) {
            sql += ` AND s.customer_id = $${paramIdx}`;
            params.push(customerId);
            paramIdx++;
        }
        if (dateFrom) {
            sql += ` AND s.created_at >= $${paramIdx}`;
            params.push(dateFrom);
            paramIdx++;
        }
        if (dateTo) {
            sql += ` AND s.created_at <= $${paramIdx}`;
            params.push(dateTo);
            paramIdx++;
        }
        if (search) {
            sql += ` AND (s.order_id ILIKE $${paramIdx} OR s.nature_of_item ILIKE $${paramIdx} OR s.awb_number ILIKE $${paramIdx} OR s.bol_number ILIKE $${paramIdx} OR c.firstname ILIKE $${paramIdx} OR c.lastname ILIKE $${paramIdx})`;
            params.push(`%${search}%`);
            paramIdx++;
        }
        const countResult = await db_1.default.query(`SELECT COUNT(*) FROM (${sql}) AS count_query`, params);
        const total = parseInt(countResult.rows[0].count);
        // Apply sorting
        let orderSql = ' ORDER BY s.created_at DESC'; // default newest
        if (sortBy === 'oldest') {
            orderSql = ' ORDER BY s.created_at ASC';
        }
        else if (sortBy === 'price-high-low' || sortBy === 'price_desc') {
            orderSql = ' ORDER BY s.invoice_value DESC';
        }
        else if (sortBy === 'price-low-high' || sortBy === 'price_asc') {
            orderSql = ' ORDER BY s.invoice_value ASC';
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
// GET /api/admin/shipments/:id
router.get('/:id', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const shipmentResult = await db_1.default.query('SELECT * FROM shipments WHERE id = $1', [req.params.id]);
        if (shipmentResult.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Shipment not found' });
        const shipment = shipmentResult.rows[0];
        const items = await db_1.default.query('SELECT * FROM shipment_items WHERE shipment_id = $1', [req.params.id]);
        const documents = await db_1.default.query('SELECT * FROM shipment_documents WHERE shipment_id = $1', [req.params.id]);
        const tracking = await db_1.default.query('SELECT * FROM tracking_updates WHERE shipment_id = $1 ORDER BY created_at ASC', [req.params.id]);
        res.json({
            success: true,
            data: { ...shipment, items: items.rows, documents: documents.rows, trackingUpdates: tracking.rows },
        });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/admin/shipments
router.post('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { customerId, shippingMode, deliveryMode, natureOfItem, hsCode, invoiceValue, invoiceCurrency, weight, weightUnit, originAddress, destinationAddress, originPickupOption, portOfDischarge, awbNumber, bolNumber, uniqueId, status = 'pending', isDraft = false, } = req.body;
        const orderId = `#${Date.now().toString(36).toUpperCase().slice(-6)}`;
        const result = await db_1.default.query(`INSERT INTO shipments (
        order_id, customer_id, shipping_mode, delivery_mode, nature_of_item, hs_code,
        invoice_value, invoice_currency, weight, weight_unit,
        origin_address, destination_address, origin_pickup_option, port_of_discharge,
        awb_number, bol_number, unique_id, status, is_draft
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *`, [
            orderId, customerId, shippingMode, deliveryMode, natureOfItem, hsCode || null,
            invoiceValue || 0, invoiceCurrency || 'NGN', weight || 0, weightUnit || 'kg',
            originAddress, destinationAddress, originPickupOption || null, portOfDischarge || null,
            awbNumber || null, bolNumber || null, uniqueId || null, status, isDraft,
        ]);
        const shipment = result.rows[0];
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'CREATE_SHIPMENT', 'shipment', shipment.id, { orderId, customerId });
        res.status(201).json({ success: true, data: shipment });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/shipments/:id/status
router.put('/:id/status', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { status, message } = req.body;
        await db_1.default.query('UPDATE shipments SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
        if (message) {
            await db_1.default.query('INSERT INTO tracking_updates (shipment_id, status, message, updated_by) VALUES ($1, $2, $3, $4)', [req.params.id, status, message, req.admin.id]);
        }
        const result = await db_1.default.query('SELECT * FROM shipments WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPDATE_SHIPMENT_STATUS', 'shipment', req.params.id, { status, message });
        res.json({ success: true, data: result.rows[0] });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/admin/shipments/:id/tracking
router.put('/:id/tracking', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { awbNumber, bolNumber, uniqueId } = req.body;
        const fields = [];
        const params = [];
        let idx = 1;
        if (awbNumber !== undefined) {
            fields.push(`awb_number = $${idx++}`);
            params.push(awbNumber);
        }
        if (bolNumber !== undefined) {
            fields.push(`bol_number = $${idx++}`);
            params.push(bolNumber);
        }
        if (uniqueId !== undefined) {
            fields.push(`unique_id = $${idx++}`);
            params.push(uniqueId);
        }
        params.push(req.params.id);
        await db_1.default.query(`UPDATE shipments SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, params);
        const result = await db_1.default.query('SELECT * FROM shipments WHERE id = $1', [req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPDATE_SHIPMENT_TRACKING_FIELDS', 'shipment', req.params.id, { awbNumber, bolNumber, uniqueId });
        res.json({ success: true, data: result.rows[0] });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/admin/shipments/:id/documents
router.post('/:id/documents', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { fileUrl, documentType } = req.body;
        const result = await db_1.default.query('INSERT INTO shipment_documents (shipment_id, document_type, file_url, uploaded_by) VALUES ($1, $2, $3, $4) RETURNING *', [req.params.id, documentType || 'other', fileUrl, req.admin.id]);
        const doc = result.rows[0];
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'UPLOAD_SHIPMENT_DOCUMENT', 'shipment', req.params.id, { documentId: doc.id, documentType });
        res.json({ success: true, data: doc });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/admin/shipments/:id/documents/:docId
router.delete('/:id/documents/:docId', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        await db_1.default.query('DELETE FROM shipment_documents WHERE id = $1 AND shipment_id = $2', [req.params.docId, req.params.id]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'DELETE_SHIPMENT_DOCUMENT', 'shipment', req.params.id, { documentId: req.params.docId });
        res.json({ success: true, message: 'Document deleted' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=shipments.routes.js.map