import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';

const router = Router();


router.get('/', adminMiddleware, async (req, res, next) => {
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

    
    const customersPromise = pool.query(
      `SELECT id, user_id, firstname, lastname, email, industry, status
       FROM customers
       WHERE firstname ILIKE $1 OR lastname ILIKE $1 OR email ILIKE $1 OR user_id ILIKE $1
       LIMIT 3;`,
      [term]
    );

    const shipmentsPromise = pool.query(
      `SELECT id, order_id, nature_of_item, status, shipping_mode, awb_number, bol_number
       FROM shipments
       WHERE order_id ILIKE $1 OR nature_of_item ILIKE $1 OR awb_number ILIKE $1 OR bol_number ILIKE $1
       LIMIT 3;`,
      [term]
    );

    const invoicesPromise = pool.query(
      `SELECT id, invoice_number, amount, currency, status
       FROM invoices
       WHERE invoice_number ILIKE $1
       LIMIT 3;`,
      [term]
    );

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
  } catch (err) {
    next(err);
  }
});

export default router;
