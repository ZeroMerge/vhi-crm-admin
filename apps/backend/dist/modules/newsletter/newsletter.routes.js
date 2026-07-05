"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../../config/db"));
const adminMiddleware_1 = require("../../middleware/adminMiddleware");
const router = (0, express_1.Router)();
router.get('/segments', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query(`SELECT industry, COUNT(*) as count, 
        JSON_AGG(JSON_BUILD_OBJECT('id', id, 'firstname', firstname, 'lastname', lastname, 'email', email)) as customers
      FROM customers GROUP BY industry ORDER BY industry`);
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
router.put('/segments/move', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { customerId, toIndustry } = req.body;
        await db_1.default.query('UPDATE customers SET industry = $1 WHERE id = $2', [toIndustry, customerId]);
        res.json({ success: true, message: 'Customer moved to new segment' });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/segments/remove', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { customerId } = req.body;
        await db_1.default.query('UPDATE customers SET industry = NULL WHERE id = $1', [customerId]);
        res.json({ success: true, message: 'Customer removed from segment' });
    }
    catch (err) {
        next(err);
    }
});
router.post('/send', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { subject, body, segments } = req.body;
        let customerIds = [];
        if (segments.includes('all')) {
            const result = await db_1.default.query('SELECT id FROM customers');
            customerIds = result.rows.map((r) => r.id);
        }
        else {
            const result = await db_1.default.query('SELECT id FROM customers WHERE industry = ANY($1)', [segments]);
            customerIds = result.rows.map((r) => r.id);
        }
        await db_1.default.query('INSERT INTO newsletter_sends (subject, body, segment, sent_by, recipient_count) VALUES ($1, $2, $3, $4, $5)', [subject, body, segments.join(','), req.admin.id, customerIds.length]);
        res.json({ success: true, message: `Newsletter sent to ${customerIds.length} recipients` });
    }
    catch (err) {
        next(err);
    }
});
router.get('/history', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const result = await db_1.default.query('SELECT * FROM newsletter_sends ORDER BY sent_at DESC');
        res.json({ success: true, data: result.rows });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=newsletter.routes.js.map