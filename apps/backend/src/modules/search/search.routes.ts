import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { CROSS_READS, roleHasAnyModule, requireActiveAdmin } from '../../middleware/permissions';

const router = Router();


// Groups the caller's role cannot read are omitted entirely (not returned empty).
router.get('/', adminMiddleware, requireActiveAdmin, async (req, res, next) => {
  try {
    const role = req.admin!.activeRole;
    const groups = {
      customers: roleHasAnyModule(role, CROSS_READS.customersList),
      shipments: roleHasAnyModule(role, CROSS_READS.shipmentsList),
      invoices: roleHasAnyModule(role, CROSS_READS.invoicesList),
    };

    const { q } = req.query;
    const term = typeof q === 'string' && q ? `%${q}%` : null;
    const none = Promise.resolve({ rows: [] as any[] });

    const [customersResult, shipmentsResult, invoicesResult] = await Promise.all([
      groups.customers && term
        ? pool.query(
            `SELECT id, user_id, firstname, lastname, email, industry, status
             FROM customers
             WHERE firstname ILIKE $1 OR lastname ILIKE $1 OR email ILIKE $1 OR user_id ILIKE $1
             LIMIT 3;`,
            [term]
          )
        : none,
      groups.shipments && term
        ? pool.query(
            `SELECT id, order_id, nature_of_item, status, shipping_mode, awb_number, bol_number
             FROM shipments
             WHERE order_id ILIKE $1 OR nature_of_item ILIKE $1 OR awb_number ILIKE $1 OR bol_number ILIKE $1
             LIMIT 3;`,
            [term]
          )
        : none,
      groups.invoices && term
        ? pool.query(
            `SELECT id, invoice_number, amount, currency, status
             FROM invoices
             WHERE invoice_number ILIKE $1
             LIMIT 3;`,
            [term]
          )
        : none,
    ]);

    const data: Record<string, any[]> = {};
    if (groups.customers) data.customers = customersResult.rows;
    if (groups.shipments) data.shipments = shipmentsResult.rows;
    if (groups.invoices) data.invoices = invoicesResult.rows;

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
