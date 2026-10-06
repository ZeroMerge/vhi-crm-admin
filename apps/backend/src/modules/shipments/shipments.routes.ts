import { Router } from 'express';
import type { PoolClient } from 'pg';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { logAuditEvent } from '../../utils/audit';
import { generateOrderId } from '../../utils/generateOrderId';
import { assertInitialStatus, assertTransition, assertValidStatus, conflictError, getAllowedTransitions } from './shipmentStatus';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Locks one shipment row for the rest of the transaction. Another transaction already holding
// the lock means a concurrent change: answer 409 instead of waiting and overwriting it.
export async function lockShipmentForUpdate(client: PoolClient, whereSql: string, params: unknown[]) {
  try {
    const result = await client.query(`SELECT * FROM shipments WHERE ${whereSql} FOR UPDATE NOWAIT`, params);
    return result.rows[0] ?? null;
  } catch (err: any) {
    if (err.code === '55P03') throw conflictError();
    throw err;
  }
}


function mapShipmentItem(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    description: row.description,
    category: row.category,
    quantity: parseInt(row.quantity || 0),
    weight: parseFloat(row.weight || 0),
    dimensionL: parseFloat(row.dimension_l || 0),
    dimensionW: parseFloat(row.dimension_w || 0),
    dimensionH: parseFloat(row.dimension_h || 0),
    dimensionUnit: row.dimension_unit || 'cm',
  };
}

function mapShipmentDocument(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    documentType: row.document_type,
    fileUrl: row.file_url,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function mapTrackingUpdate(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    status: row.status,
    message: row.message,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
  };
}

export function mapShipment(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    customerId: row.customer_id,
    shippingMode: row.shipping_mode,
    deliveryMode: row.delivery_mode,
    natureOfItem: row.nature_of_item,
    hsCode: row.hs_code,
    invoiceValue: parseFloat(row.invoice_value || 0),
    invoiceCurrency: row.invoice_currency || 'NGN',
    weight: parseFloat(row.weight || 0),
    weightUnit: row.weight_unit || 'kg',
    originAddress: row.origin_address,
    destinationAddress: row.destination_address,
    originPickupOption: row.origin_pickup_option,
    portOfDischarge: row.port_of_discharge,
    awbNumber: row.awb_number,
    bolNumber: row.bol_number,
    uniqueId: row.unique_id,
    status: row.status,
    isDraft: row.is_draft,
    originEmail: row.origin_email,
    originPhone: row.origin_phone,
    destinationEmail: row.destination_email,
    destinationPhone: row.destination_phone,
    countryOfOrigin: row.country_of_origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customer: (row.firstname || row.customer_firstname) ? {
      id: row.customer_id,
      firstname: row.firstname || row.customer_firstname,
      lastname: row.lastname || row.customer_lastname,
      email: row.email || row.customer_email,
      phone: row.phone || row.customer_phone,
      industry: row.industry || row.customer_industry,
    } : (row.customer || undefined),
    items: row.items ? row.items.map(mapShipmentItem) : undefined,
    documents: row.documents ? row.documents.map(mapShipmentDocument) : undefined,
    trackingUpdates: row.trackingUpdates ? row.trackingUpdates.map(mapTrackingUpdate) : undefined,
    // snake_case aliases for legacy compatibility
    order_id: row.order_id,
    customer_id: row.customer_id,
    shipping_mode: row.shipping_mode,
    delivery_mode: row.delivery_mode,
    nature_of_item: row.nature_of_item,
    origin_address: row.origin_address,
    destination_address: row.destination_address,
    invoice_value: row.invoice_value,
    invoice_currency: row.invoice_currency,
    awb_number: row.awb_number,
    bol_number: row.bol_number,
    unique_id: row.unique_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.get('/', adminMiddleware, async (req, res, next) => {
  try {
    const { status, mode, customerId, search, dateFrom, dateTo, sortBy, page = '1', pageSize = '10' } = req.query;
    let sql = 'SELECT s.*, c.firstname, c.lastname, c.email, c.phone, c.industry FROM shipments s LEFT JOIN customers c ON s.customer_id = c.id WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (status && status !== 'all') { sql += ` AND s.status = $${paramIdx}`; params.push(status); paramIdx++; }
    if (mode && mode !== 'all') { sql += ` AND s.shipping_mode = $${paramIdx}`; params.push(mode); paramIdx++; }
    if (customerId) { sql += ` AND s.customer_id = $${paramIdx}`; params.push(customerId); paramIdx++; }
    
    if (dateFrom) {
      sql += ` AND s.created_at >= $${paramIdx}`;
      params.push(dateFrom);
      paramIdx++;
    }
    if (dateTo) {
      sql += ` AND s.created_at <= $${paramIdx}`;
      params.push(dateTo);
      paramIdx++;
    }

    if (search) {
      sql += ` AND (s.order_id ILIKE $${paramIdx} OR s.nature_of_item ILIKE $${paramIdx} OR s.awb_number ILIKE $${paramIdx} OR s.bol_number ILIKE $${paramIdx} OR c.firstname ILIKE $${paramIdx} OR c.lastname ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM (${sql}) AS count_query`, params);
    const total = parseInt(countResult.rows[0].count);

    
    let orderSql = ' ORDER BY s.created_at DESC'; 
    if (sortBy === 'oldest') {
      orderSql = ' ORDER BY s.created_at ASC';
    } else if (sortBy === 'price-high-low' || sortBy === 'price_desc') {
      orderSql = ' ORDER BY s.invoice_value DESC';
    } else if (sortBy === 'price-low-high' || sortBy === 'price_asc') {
      orderSql = ' ORDER BY s.invoice_value ASC';
    }

    sql += orderSql;
    sql += ` LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(parseInt(pageSize as string), (parseInt(page as string) - 1) * parseInt(pageSize as string));

    const result = await pool.query(sql, params);
    res.json({
      success: true,
      data: result.rows.map(mapShipment),
      pagination: { total, page: parseInt(page as string), pageSize: parseInt(pageSize as string), totalPages: Math.ceil(total / parseInt(pageSize as string)) },
    });
  } catch (err) { next(err); }
});

router.get('/:id', adminMiddleware, async (req, res, next) => {
  try {
    const shipmentResult = await pool.query(
      `SELECT s.*, c.firstname, c.lastname, c.email, c.phone, c.industry 
       FROM shipments s 
       LEFT JOIN customers c ON s.customer_id = c.id 
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (shipmentResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Shipment not found' });

    const shipment = shipmentResult.rows[0];
    const items = await pool.query('SELECT * FROM shipment_items WHERE shipment_id = $1', [req.params.id]);
    const allowedTransitions = getAllowedTransitions(shipment.status, 'admin', req.admin!.activeRole);
    const documents = await pool.query('SELECT * FROM shipment_documents WHERE shipment_id = $1', [req.params.id]);
    const tracking = await pool.query('SELECT * FROM tracking_updates WHERE shipment_id = $1 ORDER BY created_at ASC', [req.params.id]);

    res.json({
      success: true,
      data: {
        ...mapShipment({
          ...shipment,
          items: items.rows,
          documents: documents.rows,
          trackingUpdates: tracking.rows
        }),
        allowedTransitions,
      },
    });
  } catch (err) { next(err); }
});


router.post('/', adminMiddleware, async (req, res, next) => {
  try {
    const {
      customerId, shippingMode, deliveryMode, natureOfItem, hsCode,
      invoiceValue, invoiceCurrency, weight, weightUnit,
      originAddress, destinationAddress, originPickupOption, portOfDischarge,
      awbNumber, bolNumber, uniqueId, status = 'pending', isDraft = false,
    } = req.body;

    const initialStatus = assertInitialStatus(status, 'admin');
    const orderId = generateOrderId('admin', shippingMode);

    const result = await pool.query(
      `INSERT INTO shipments (
        order_id, customer_id, shipping_mode, delivery_mode, nature_of_item, hs_code,
        invoice_value, invoice_currency, weight, weight_unit,
        origin_address, destination_address, origin_pickup_option, port_of_discharge,
        awb_number, bol_number, unique_id, status, is_draft
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *`,
      [
        orderId, customerId, shippingMode, deliveryMode, natureOfItem, hsCode || null,
        invoiceValue || 0, invoiceCurrency || 'NGN', weight || 0, weightUnit || 'kg',
        originAddress, destinationAddress, originPickupOption || null, portOfDischarge || null,
        awbNumber || null, bolNumber || null, uniqueId || null, initialStatus, isDraft,
      ]
    );

    const shipment = result.rows[0];
    await logAuditEvent(req.admin!.id, 'admin', req.admin!.activeRole, 'CREATE_SHIPMENT', 'shipment', shipment.id, { orderId, customerId });
    res.status(201).json({ success: true, data: mapShipment(shipment) });
  } catch (err) { next(err); }
});


// Body: { status, message?, reason?, expectedStatus? }. Rules live in ./shipmentStatus.ts.
// expectedStatus is the status the caller last saw; a mismatch means someone else changed it (409).
router.put('/:id/status', adminMiddleware, async (req, res, next) => {
  const { status, message, reason, expectedStatus } = req.body;
  try {
    assertValidStatus(status);
  } catch (err) { return next(err); }
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'Shipment not found' });

  let client;
  try {
    client = await pool.connect();
  } catch (err) { return next(err); }
  let transition;
  try {
    await client.query('BEGIN');

    const current = await lockShipmentForUpdate(client, 'id = $1', [req.params.id]);
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Shipment not found' });
    }
    if (expectedStatus !== undefined && expectedStatus !== current.status) throw conflictError();

    transition = assertTransition({
      from: current.status,
      to: status,
      actorType: 'admin',
      actorRole: req.admin!.activeRole,
      reason,
    });

    await client.query('UPDATE shipments SET status = $1, updated_at = NOW() WHERE id = $2', [transition.to, current.id]);
    if (message) {
      await client.query(
        'INSERT INTO tracking_updates (shipment_id, status, message, updated_by) VALUES ($1, $2, $3, $4)',
        [current.id, transition.to, message, req.admin!.id]
      );
    }

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
      'UPDATE_SHIPMENT_STATUS',
      'shipment',
      req.params.id,
      {
        from: transition.from,
        to: transition.to,
        reason: reason ?? null,
        isCorrection: transition.isCorrection,
        isReopen: transition.isReopen,
        message: message ?? null,
      }
    );

    const result = await pool.query(
      `SELECT s.*, c.firstname, c.lastname, c.email, c.phone, c.industry 
       FROM shipments s 
       LEFT JOIN customers c ON s.customer_id = c.id 
       WHERE s.id = $1`,
      [req.params.id]
    );
    const updated = result.rows[0];

    res.json({
      success: true,
      data: {
        ...mapShipment(updated),
        allowedTransitions: getAllowedTransitions(updated.status, 'admin', req.admin!.activeRole),
      },
    });
  } catch (err) { next(err); }
});


router.put('/:id/tracking', adminMiddleware, async (req, res, next) => {
  try {
    const { awbNumber, bolNumber, uniqueId } = req.body;
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (awbNumber !== undefined) { fields.push(`awb_number = $${idx++}`); params.push(awbNumber); }
    if (bolNumber !== undefined) { fields.push(`bol_number = $${idx++}`); params.push(bolNumber); }
    if (uniqueId !== undefined) { fields.push(`unique_id = $${idx++}`); params.push(uniqueId); }

    params.push(req.params.id);
    await pool.query(`UPDATE shipments SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, params);
    const result = await pool.query(
      `SELECT s.*, c.firstname, c.lastname, c.email, c.phone, c.industry 
       FROM shipments s 
       LEFT JOIN customers c ON s.customer_id = c.id 
       WHERE s.id = $1`,
      [req.params.id]
    );

    
    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'UPDATE_SHIPMENT_TRACKING_FIELDS',
      'shipment',
      req.params.id,
      { awbNumber, bolNumber, uniqueId }
    );

    res.json({ success: true, data: mapShipment(result.rows[0]) });
  } catch (err) { next(err); }
});


router.post('/:id/documents', adminMiddleware, async (req, res, next) => {
  try {
    const { fileUrl, documentType } = req.body;
    const result = await pool.query(
      'INSERT INTO shipment_documents (shipment_id, document_type, file_url, uploaded_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, documentType || 'other', fileUrl, req.admin!.id]
    );
    const doc = result.rows[0];

    
    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'UPLOAD_SHIPMENT_DOCUMENT',
      'shipment',
      req.params.id,
      { documentId: doc.id, documentType }
    );

    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});


router.delete('/:id/documents/:docId', adminMiddleware, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM shipment_documents WHERE id = $1 AND shipment_id = $2', [req.params.docId, req.params.id]);

    
    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'DELETE_SHIPMENT_DOCUMENT',
      'shipment',
      req.params.id,
      { documentId: req.params.docId }
    );

    res.json({ success: true, message: 'Document deleted' });
  } catch (err) { next(err); }
});

export default router;
