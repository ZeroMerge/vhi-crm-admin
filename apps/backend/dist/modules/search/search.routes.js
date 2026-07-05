"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../../config/db"));
const adminMiddleware_1 = require("../../middleware/adminMiddleware");
const router = (0, express_1.Router)();
router.get('/', adminMiddleware_1.adminMiddleware, async (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string') {
            return res.json({
                success: true,
                data: {
                    customers: [],
                    shipments: [],
                    invoices: []
                }
            });
        }
        const term = `%${q}%`;
        const customersPromise = db_1.default.query(`SELECT id, user_id, firstname, lastname, email, industry, status
       FROM customers
       WHERE firstname ILIKE $1 OR lastname ILIKE $1 OR email ILIKE $1 OR user_id ILIKE $1
       LIMIT 3;`, [term]);
        const shipmentsPromise = db_1.default.query(`SELECT id, order_id, nature_of_item, status, shipping_mode, awb_number, bol_number
       FROM shipments
       WHERE order_id ILIKE $1 OR nature_of_item ILIKE $1 OR awb_number ILIKE $1 OR bol_number ILIKE $1
       LIMIT 3;`, [term]);
        const invoicesPromise = db_1.default.query(`SELECT id, invoice_number, amount, currency, status
       FROM invoices
       WHERE invoice_number ILIKE $1
       LIMIT 3;`, [term]);
        const [customersResult, shipmentsResult, invoicesResult] = await Promise.all([
            customersPromise,
            shipmentsPromise,
            invoicesPromise
        ]);
        res.json({
            success: true,
            data: {
                customers: customersResult.rows,
                shipments: shipmentsResult.rows,
                invoices: invoicesResult.rows
            }
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=search.routes.js.map