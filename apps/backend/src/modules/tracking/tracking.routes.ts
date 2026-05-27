import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { logAuditEvent } from '../../utils/audit';

const router = Router();

// GET /api/admin/tracking -> List with page-adaptive tracking filters
router.get('/', adminMiddleware, async (req, res, next) => {
  try {
    const { search, filter, mode } = req.query;
    let sql = `
      SELECT s.*, c.firstname, c.lastname 
      FROM shipments s 
      LEFT JOIN customers c ON s.customer_id = c.id 
      WHERE s.status NOT IN ('draft', 'cancelled')
    `;
    const params: any[] = [];
    let paramIdx = 1;

    // Tracking ID status filter
    if (filter === 'missing') {
      sql += ` AND s.awb_number IS NULL AND s.bol_number IS NULL AND s.unique_id IS NULL`;
    } else if (filter === 'has_awb') {
      sql += ` AND s.awb_number IS NOT NULL`;
    } else if (filter === 'has_bol') {
      sql += ` AND s.bol_number IS NOT NULL`;
    } else if (filter === 'has_unique') {
      sql += ` AND s.unique_id IS NOT NULL`;
    }

    // Shipping mode filter
    if (mode && mode !== 'all') {
      if (mode === 'sea') {
        sql += ` AND s.shipping_mode IN ('groupage', 'consolidation', 'china_groupage')`;
      } else {
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

    const result = await pool.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// GET /api/admin/tracking/pending
router.get('/pending', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.*, c.firstname, c.lastname FROM shipments s 
       LEFT JOIN customers c ON s.customer_id = c.id 
       WHERE s.awb_number IS NULL AND s.bol_number IS NULL AND s.unique_id IS NULL 
       AND s.status NOT IN ('draft', 'cancelled') 
       ORDER BY s.created_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// POST /api/admin/tracking/:shipmentId/update
router.post('/:shipmentId/update', adminMiddleware, async (req, res, next) => {
  try {
    const { status, message } = req.body;
    const result = await pool.query(
      'INSERT INTO tracking_updates (shipment_id, status, message, updated_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.shipmentId, status, message || '', req.admin!.id]
    );
    await pool.query('UPDATE shipments SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.shipmentId]);

    // Log audit event
    await logAuditEvent(
      req.admin!.id,
      req.admin!.activeRole,
      'ADD_TRACKING_UPDATE',
      'shipment',
      req.params.shipmentId,
      { status, message }
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /api/tracking/:trackingId (public)
const publicRouter = Router();
publicRouter.get('/:trackingId', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM shipments WHERE awb_number = $1 OR bol_number = $1 OR unique_id = $1',
      [req.params.trackingId]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Tracking ID not found' });
    
    const shipment = result.rows[0];
    const updates = await pool.query('SELECT * FROM tracking_updates WHERE shipment_id = $1 ORDER BY created_at ASC', [shipment.id]);
    res.json({ success: true, data: { ...shipment, trackingUpdates: updates.rows } });
  } catch (err) { next(err); }
});

export { router as adminTrackingRoutes, publicRouter as publicTrackingRoutes };
