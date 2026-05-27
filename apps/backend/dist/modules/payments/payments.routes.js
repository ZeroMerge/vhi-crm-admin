"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../../config/db"));
const adminMiddleware_1 = require("../../middleware/adminMiddleware");
const router = (0, express_1.Router)();
// GET /api/admin/payments
router.get('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { status, page = '1', pageSize = '10' } = req.query;
        let sql = 'SELECT p.*, c.firstname, c.lastname FROM payments p LEFT JOIN customers c ON p.customer_id = c.id WHERE 1=1';
        const params = [];
        let paramIdx = 1;
        if (status) {
            sql += ` AND p.payment_status = $${paramIdx}`;
            params.push(status);
            paramIdx++;
        }
        const countResult = await db_1.default.query(`SELECT COUNT(*) FROM (${sql}) AS count_query`, params);
        const total = parseInt(countResult.rows[0].count);
        sql += ` ORDER BY p.created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
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
// Paystack routes
router.post('/paystack/initialize', async (req, res, next) => {
    try {
        const { invoiceId, email, amount, currency } = req.body;
        const reference = `PSK-${Date.now()}`;
        res.json({
            success: true,
            data: { authorization_url: 'https://paystack.com/pay/test', reference },
        });
    }
    catch (err) {
        next(err);
    }
});
router.post('/paystack/verify', async (req, res, next) => {
    try {
        const { reference } = req.body;
        res.json({ success: true, data: { status: 'success', reference } });
    }
    catch (err) {
        next(err);
    }
});
router.post('/paystack/webhook', async (req, res, next) => {
    try {
        res.status(200).send('OK');
    }
    catch (err) {
        next(err);
    }
});
// Stripe routes
router.post('/stripe/intent', async (req, res, next) => {
    try {
        const { invoiceId, amount, currency } = req.body;
        res.json({
            success: true,
            data: { clientSecret: `pi_${Date.now()}_secret_test` },
        });
    }
    catch (err) {
        next(err);
    }
});
router.post('/stripe/confirm', async (req, res, next) => {
    try {
        const { paymentIntentId } = req.body;
        res.json({ success: true, data: { status: 'succeeded' } });
    }
    catch (err) {
        next(err);
    }
});
router.post('/stripe/webhook', async (req, res, next) => {
    try {
        res.status(200).send('OK');
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=payments.routes.js.map