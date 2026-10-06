import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { CROSS_READS, moduleGuard, requireActiveAdmin } from '../../middleware/permissions';
import { logAuditEvent } from '../../utils/audit';
import { UUID_RE, lockShipmentForUpdate, mapShipment } from '../shipments/shipments.routes';
import { assertTransition, assertValidStatus, conflictError } from '../shipments/shipmentStatus';

const router = Router();

router.use(adminMiddleware, requireActiveAdmin, moduleGuard('tracking', [{ method: 'POST', path: '/:shipmentId/update', anyOf: CROSS_READS.trackingNote }]));


router.get('/', adminMiddleware, async (req, res, next) => {
  try {
    const { search, filter, mode } = req.query;
    let sql = `
      SELECT s.*, c.firstname, c.lastname, c.email, c.phone, c.industry 
      FROM shipments s 
      LEFT JOIN customers c ON s.customer_id = c.id 
      WHERE s.status NOT IN ('draft', 'cancelled')
    `;
    const params: any[] = [];
    let paramIdx = 1;

    
    if (filter === 'missing') {
      sql += ` AND s.awb_number IS NULL AND s.bol_number IS NULL AND s.unique_id IS NULL`;
    } else if (filter === 'has_awb') {
      sql += ` AND s.awb_number IS NOT NULL`;
    } else if (filter === 'has_bol') {
      sql += ` AND s.bol_number IS NOT NULL`;
    } else if (filter === 'has_unique') {
      sql += ` AND s.unique_id IS NOT NULL`;
    }

    
    if (mode && mode !== 'all') {
      if (mode === 'sea') {
        sql += ` AND s.shipping_mode IN ('groupage', 'consolidation', 'china_groupage')`;
      } else {
        sql += ` AND s.shipping_mode = $${paramIdx}`;
        params.push(mode);
        paramIdx++;
      }
    }

    
    if (search) {
      sql += ` AND (s.order_id ILIKE $${paramIdx} OR s.awb_number ILIKE $${paramIdx} OR s.bol_number ILIKE $${paramIdx} OR s.unique_id ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    sql += ' ORDER BY s.created_at DESC';

    const result = await pool.query(sql, params);
    res.json({ success: true, data: result.rows.map(mapShipment) });
  } catch (err) { next(err); }
});


router.get('/pending', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.*, c.firstname, c.lastname, c.email, c.phone, c.industry FROM shipments s 
       LEFT JOIN customers c ON s.customer_id = c.id 
       WHERE s.awb_number IS NULL AND s.bol_number IS NULL AND s.unique_id IS NULL 
       AND s.status NOT IN ('draft', 'cancelled') 
       ORDER BY s.created_at DESC`
    );
    res.json({ success: true, data: result.rows.map(mapShipment) });
  } catch (err) { next(err); }
});


// Body: { status?, message?, reason?, expectedStatus? }.
// - status omitted/empty or equal to the current status → note-only: one tracking row, shipment untouched (message required).
// - otherwise the change goes through the shipment state machine (../shipments/shipmentStatus.ts).
// Everything is one transaction: on any failure nothing is written.
router.post('/:shipmentId/update', adminMiddleware, async (req, res, next) => {
  const { status, message, reason, expectedStatus } = req.body;
  const statusGiven = status !== undefined && status !== null && status !== '';
  const text = typeof message === 'string' ? message.trim() : '';
  try {
    if (statusGiven) assertValidStatus(status);
    if (message !== undefined && message !== null && typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'message must be a string' });
    }
  } catch (err) { return next(err); }
  if (!UUID_RE.test(req.params.shipmentId)) return res.status(404).json({ success: false, message: 'Shipment not found' });

  let client;
  try {
    client = await pool.connect();
  } catch (err) { return next(err); }
  let trackingRow;
  let auditMetadata;
  try {
    await client.query('BEGIN');

    const current = await lockShipmentForUpdate(client, 'id = $1', [req.params.shipmentId]);
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Shipment not found' });
    }
    if (expectedStatus !== undefined && expectedStatus !== current.status) throw conflictError();

    const noteOnly = !statusGiven || status === current.status;
    if (noteOnly) {
      if (!text) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'A message is required for a tracking note without a status change' });
      }
      auditMetadata = { noteOnly: true, status: current.status, message: text };
    } else {
      const transition = assertTransition({
        from: current.status,
        to: status,
        actorType: 'admin',
        actorRole: req.admin!.activeRole,
        reason,
      });
      await client.query('UPDATE shipments SET status = $1, updated_at = NOW() WHERE id = $2', [transition.to, current.id]);
      auditMetadata = {
        noteOnly: false,
        from: transition.from,
        to: transition.to,
        reason: reason ?? null,
        isCorrection: transition.isCorrection,
        isReopen: transition.isReopen,
        message: text || null,
      };
    }

    const result = await client.query(
      'INSERT INTO tracking_updates (shipment_id, status, message, updated_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [current.id, noteOnly ? current.status : status, text, req.admin!.id]
    );
    trackingRow = result.rows[0];

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }

  try {
    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'ADD_TRACKING_UPDATE',
      'shipment',
      req.params.shipmentId,
      auditMetadata
    );

    res.json({ success: true, data: trackingRow });
  } catch (err) { next(err); }
});


router.get('/:shipmentId/events', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tracking_updates WHERE shipment_id = $1 ORDER BY created_at ASC',
      [req.params.shipmentId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});


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
