import { Router } from 'express';
import { z } from 'zod';
import pool from '../../config/db';
import { customerMiddleware } from '../../middleware/customerMiddleware';

const router = Router();
const messageSchema = z.object({
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(10000),
});

router.get('/', customerMiddleware, async (req, res, next) => {
  try {
    const customerId = req.customer!.id;
    const result = await pool.query(
      `SELECT *, sender_type AS "senderType", (sender_type = 'customer') AS "sentByCustomer"
       FROM communications WHERE customer_id = $1 ORDER BY created_at ASC`,
      [customerId]
    );
    await pool.query(
      `UPDATE communications SET read_by_customer = true
       WHERE customer_id = $1 AND sender_type = 'admin' AND read_by_customer = false`,
      [customerId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

router.get('/unread-count', customerMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM communications
       WHERE customer_id = $1 AND sender_type = 'admin' AND read_by_customer = false`,
      [req.customer!.id]
    );
    res.json({ success: true, data: { count: result.rows[0].count }, count: result.rows[0].count });
  } catch (err) { next(err); }
});

router.post('/send', customerMiddleware, async (req, res, next) => {
  try {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.flatten().fieldErrors });
    }
    const customerId = req.customer!.id;
    const customer = await pool.query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (customer.rows.length === 0) return res.status(404).json({ success: false, message: 'Customer not found' });
    const { subject, body } = parsed.data;
    const result = await pool.query(
      `INSERT INTO communications (customer_id, sent_by_customer, sender_type, subject, body, read_by_admin, read_by_customer)
       VALUES ($1, $1, 'customer', $2, $3, false, true)
       RETURNING *, sender_type AS "senderType", true AS "sentByCustomer"`,
      [customerId, subject, body]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

export default router;
