import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { logAuditEvent } from '../../utils/audit';

const router = Router();

// GET /api/admin/customers
router.get('/', adminMiddleware, async (req, res, next) => {
  try {
    const { search, industry, star, status, sortBy, page = '1', pageSize = '10' } = req.query;
    let sql = 'SELECT * FROM customers WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      sql += ` AND (firstname ILIKE $${paramIdx} OR lastname ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR user_id ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (industry && industry !== 'all') { sql += ` AND industry = $${paramIdx}`; params.push(industry); paramIdx++; }
    if (star && star !== 'all') { sql += ` AND star_rating = $${paramIdx}`; params.push(parseInt(star as string)); paramIdx++; }
    if (status && status !== 'all') { sql += ` AND status = $${paramIdx}`; params.push(status); paramIdx++; }

    const countResult = await pool.query(`SELECT COUNT(*) FROM (${sql}) AS count_query`, params);
    const total = parseInt(countResult.rows[0].count);

    // Apply sorting
    let orderSql = ' ORDER BY created_at DESC'; // default Newest
    if (sortBy === 'oldest') {
      orderSql = ' ORDER BY created_at ASC';
    } else if (sortBy === 'name-a-z' || sortBy === 'name_asc') {
      orderSql = ' ORDER BY firstname ASC, lastname ASC';
    } else if (sortBy === 'name-z-a' || sortBy === 'name_desc') {
      orderSql = ' ORDER BY firstname DESC, lastname DESC';
    } else if (sortBy === 'star-high-low' || sortBy === 'star_desc') {
      orderSql = ' ORDER BY star_rating DESC';
    }

    sql += orderSql;
    sql += ` LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(parseInt(pageSize as string), (parseInt(page as string) - 1) * parseInt(pageSize as string));

    const result = await pool.query(sql, params);
    res.json({
      success: true,
      data: result.rows,
      pagination: { total, page: parseInt(page as string), pageSize: parseInt(pageSize as string), totalPages: Math.ceil(total / parseInt(pageSize as string)) },
    });
  } catch (err) { next(err); }
});

// GET /api/admin/customers/:id
router.get('/:id', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Customer not found' });

    const shipmentCount = await pool.query('SELECT COUNT(*) FROM shipments WHERE customer_id = $1', [req.params.id]);
    const paymentTotal = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE customer_id = $1 AND payment_status = $2', [req.params.id, 'success']);

    res.json({
      success: true,
      data: { ...result.rows[0], shipmentCount: parseInt(shipmentCount.rows[0].count), paymentTotal: parseFloat(paymentTotal.rows[0].total) },
    });
  } catch (err) { next(err); }
});

// PUT /api/admin/customers/:id/star
router.put('/:id/star', adminMiddleware, async (req, res, next) => {
  try {
    const { starRating } = req.body;
    await pool.query('UPDATE customers SET star_rating = $1 WHERE id = $2', [starRating, req.params.id]);
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    
    // Log audit event
    await logAuditEvent(req.admin!.id, req.admin!.activeRole, 'UPDATE_CUSTOMER_STAR', 'customer', req.params.id, { starRating });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/admin/customers/:id/status
router.put('/:id/status', adminMiddleware, async (req, res, next) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE customers SET status = $1 WHERE id = $2', [status, req.params.id]);
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);

    // Log audit event
    await logAuditEvent(req.admin!.id, req.admin!.activeRole, 'UPDATE_CUSTOMER_STATUS', 'customer', req.params.id, { status });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/admin/customers/:id/segment
router.put('/:id/segment', adminMiddleware, async (req, res, next) => {
  try {
    const { industry } = req.body;
    await pool.query('UPDATE customers SET industry = $1 WHERE id = $2', [industry, req.params.id]);
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);

    // Log audit event
    await logAuditEvent(req.admin!.id, req.admin!.activeRole, 'UPDATE_CUSTOMER_SEGMENT', 'customer', req.params.id, { industry });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/admin/customers/:id
router.delete('/:id', adminMiddleware, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);

    // Log audit event
    await logAuditEvent(req.admin!.id, req.admin!.activeRole, 'DELETE_CUSTOMER', 'customer', req.params.id);

    res.json({ success: true, message: 'Customer deleted' });
  } catch (err) { next(err); }
});

// GET /api/admin/customers/:id/shipments
router.get('/:id/shipments', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM shipments WHERE customer_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// GET /api/admin/customers/:id/payments
router.get('/:id/payments', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE customer_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

export default router;
