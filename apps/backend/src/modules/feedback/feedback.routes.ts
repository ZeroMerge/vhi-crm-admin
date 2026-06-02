import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';

const router = Router();

// GET /api/admin/feedback
router.get('/', adminMiddleware, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT cf.*, c.firstname, c.lastname, c.email
       FROM customer_feedback cf
       LEFT JOIN customers c ON cf.customer_id = c.id
       ORDER BY cf.created_at DESC`
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/feedback
router.post('/', adminMiddleware, async (req, res, next) => {
  try {
    const { customerId, rating, message } = req.body;
    const result = await pool.query(
      'INSERT INTO customer_feedback (customer_id, rating, message) VALUES ($1, $2, $3) RETURNING *',
      [customerId, rating, message]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;