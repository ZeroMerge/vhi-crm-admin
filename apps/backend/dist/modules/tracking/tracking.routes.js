"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicTrackingRoutes = exports.adminTrackingRoutes = void 0;
const express_1 = require("express");
const db_1 = __importDefault(require("../../config/db"));
const adminMiddleware_1 = require("../../middleware/adminMiddleware");
const audit_1 = require("../../utils/audit");
const router = (0, express_1.Router)();
exports.adminTrackingRoutes = router;
// GET /api/admin/tracking -> List with page-adaptive tracking filters
router.get('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { search, filter, mode } = req.query;
        let sql = `
      SELECT s.*, c.firstname, c.lastname 
      FROM shipments s 
      LEFT JOIN customers c ON s.customer_id = c.id 
      WHERE s.status NOT IN ('draft', 'cancelled')
    `;
        const params = [];
        let paramIdx = 1;
        // Tracking ID status filter
        if (filter === 'missing') {
            sql += ` AND s.awb_number IS NULL AND s.bol_number IS NULL AND s.unique_id IS NULL`;
        }
        else if (filter === 'has_awb') {
            sql += ` AND s.awb_number IS NOT NULL`;
        }
        else if (filter === 'has_bol') {
            sql += ` AND s.bol_number IS NOT NULL`;
        }
        else if (filter === 'has_unique') {
            sql += ` AND s.unique_id IS NOT NULL`;
        }
        // Shipping mode filter
        if (mode && mode !== 'all') {
            if (mode === 'sea') {
                sql += ` AND s.shipping_mode IN ('groupage', 'consolidation', 'china_groupage')`;
            }
            else {
                sql += ` AND s.shipping_mode = $${paramIdx}`;
                params.push(mode);
                paramIdx++;
            }
        }
        // Search query
        if (search) {
            sql += ` AND (s.order_id ILIKE $${paramIdx} OR s.awb_number ILIKE $${paramIdx} OR s.bol_number ILIKE $${paramIdx} OR s.unique_id ILIKE $${paramIdx})`;
            params.push(`%${search}%`);
            paramIdx++;
        }
        sql += ' ORDER BY s.created_at DESC';
        const result = await db_1.default.query(sql, params);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/tracking/pending
router.get('/pending', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query(`SELECT s.*, c.firstname, c.lastname FROM shipments s 
       LEFT JOIN customers c ON s.customer_id = c.id 
       WHERE s.awb_number IS NULL AND s.bol_number IS NULL AND s.unique_id IS NULL 
       AND s.status NOT IN ('draft', 'cancelled') 
       ORDER BY s.created_at DESC`);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/admin/tracking/:shipmentId/update
router.post('/:shipmentId/update', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { status, message } = req.body;
        const result = await db_1.default.query('INSERT INTO tracking_updates (shipment_id, status, message, updated_by) VALUES ($1, $2, $3, $4) RETURNING *', [req.params.shipmentId, status, message || '', req.admin.id]);
        await db_1.default.query('UPDATE shipments SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.shipmentId]);
        // Log audit event
        await (0, audit_1.logAuditEvent)(req.admin.id, req.admin.activeRole, 'ADD_TRACKING_UPDATE', 'shipment', req.params.shipmentId, { status, message });
        res.json({ success: true, data: result.rows[0] });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/admin/tracking/:shipmentId/events
router.get('/:shipmentId/events', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query('SELECT * FROM tracking_updates WHERE shipment_id = $1 ORDER BY created_at ASC', [req.params.shipmentId]);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/tracking/:trackingId (public)
const publicRouter = (0, express_1.Router)();
exports.publicTrackingRoutes = publicRouter;
publicRouter.get('/:trackingId', async (req, res, next) => {
    try {
        const result = await db_1.default.query('SELECT * FROM shipments WHERE awb_number = $1 OR bol_number = $1 OR unique_id = $1', [req.params.trackingId]);
        if (result.rows.length === 0)
            return res.status(404).json({ success: false, message: 'Tracking ID not found' });
        const shipment = result.rows[0];
        const updates = await db_1.default.query('SELECT * FROM tracking_updates WHERE shipment_id = $1 ORDER BY created_at ASC', [shipment.id]);
        res.json({ success: true, data: { ...shipment, trackingUpdates: updates.rows } });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=tracking.routes.js.map