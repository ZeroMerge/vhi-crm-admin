import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { CROSS_READS, moduleGuard, requireActiveAdmin } from '../../middleware/permissions';
import { logAuditEvent } from '../../utils/audit';

const router = Router();

router.use(adminMiddleware, requireActiveAdmin, moduleGuard('invoices', [{ method: 'GET', path: '/', anyOf: CROSS_READS.invoicesList }]));

function mapInvoice(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    shipmentId: row.shipment_id,
    customerId: row.customer_id,
    amount: parseFloat(row.amount),
    currency: row.currency,
    status: row.status,
    dueDate: row.due_date,
    followUpDate: row.follow_up_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customer: row.customer_id ? {
      id: row.customer_id,
      firstname: row.firstname || row.customer_firstname,
      lastname: row.lastname || row.customer_lastname,
      email: row.email || row.customer_email,
      phone: row.phone || row.customer_phone,
    } : null,
    shipment: row.shipment_id ? {
      id: row.shipment_id,
      orderId: row.shipment_order_id || row.order_id,
      status: row.shipment_status || row.status,
    } : null,
  };
}


router.get('/', adminMiddleware, async (req, res, next) => {
  try {
    const { status, currency, customerId, search, dateFrom, dateTo, overdue, sortBy, page = '1', pageSize = '10' } = req.query;
    let sql = 'SELECT i.*, c.firstname, c.lastname, c.email, s.order_id as shipment_order_id FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id LEFT JOIN shipments s ON i.shipment_id = s.id WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (status && status !== 'all') { sql += ` AND i.status = $${paramIdx}`; params.push(status); paramIdx++; }
    if (currency && currency !== 'all') { sql += ` AND i.currency = $${paramIdx}`; params.push(currency); paramIdx++; }
    if (customerId) { sql += ` AND i.customer_id = $${paramIdx}`; params.push(customerId); paramIdx++; }
    
    if (dateFrom) {
      sql += ` AND i.created_at >= $${paramIdx}`;
      params.push(dateFrom);
      paramIdx++;
    }
    if (dateTo) {
      sql += ` AND i.created_at <= $${paramIdx}`;
      params.push(dateTo);
      paramIdx++;
    }

    if (overdue === 'true') {
      sql += ` AND i.due_date < CURRENT_DATE AND i.status != 'paid'`;
    }

    if (search) {
      sql += ` AND (i.invoice_number ILIKE $${paramIdx} OR c.firstname ILIKE $${paramIdx} OR c.lastname ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM (${sql}) AS count_query`, params);
    const total = parseInt(countResult.rows[0].count);

    
    let orderSql = ' ORDER BY i.created_at DESC'; 
    if (sortBy === 'oldest') {
      orderSql = ' ORDER BY i.created_at ASC';
    } else if (sortBy === 'amount-high-low' || sortBy === 'amount_desc') {
      orderSql = ' ORDER BY i.amount DESC';
    } else if (sortBy === 'amount-low-high' || sortBy === 'amount_asc') {
      orderSql = ' ORDER BY i.amount ASC';
    }

    sql += orderSql;
    sql += ` LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(parseInt(pageSize as string), (parseInt(page as string) - 1) * parseInt(pageSize as string));

    const result = await pool.query(sql, params);
    res.json({
      success: true,
      data: result.rows.map(mapInvoice),
      pagination: { total, page: parseInt(page as string), pageSize: parseInt(pageSize as string), totalPages: Math.ceil(total / parseInt(pageSize as string)) },
    });
  } catch (err) { next(err); }
});


router.get('/:id', adminMiddleware, async (req, res, next) => {
  try {
    const invoiceResult = await pool.query(
      `SELECT i.*, 
              c.firstname as customer_firstname, c.lastname as customer_lastname, c.email as customer_email, c.phone as customer_phone,
              s.order_id as shipment_order_id, s.status as shipment_status
       FROM invoices i 
       LEFT JOIN customers c ON i.customer_id = c.id 
       LEFT JOIN shipments s ON i.shipment_id = s.id 
       WHERE i.id = $1`, 
      [req.params.id]
    );
    if (invoiceResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const payments = await pool.query('SELECT * FROM payments WHERE invoice_id = $1', [req.params.id]);
    const mappedPayments = payments.rows.map(row => ({
      id: row.id,
      invoiceId: row.invoice_id,
      customerId: row.customer_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      gatewayReference: row.gateway_reference,
      receiptUrl: row.receipt_url,
      paidAt: row.paid_at,
      createdAt: row.created_at,
    }));
    res.json({ success: true, data: { ...mapInvoice(invoiceResult.rows[0]), payments: mappedPayments } });
  } catch (err) { next(err); }
});


router.post('/', adminMiddleware, async (req, res, next) => {
  try {
    const { customerId, shipmentId, amount, currency, dueDate, notes } = req.body;
    const invoiceNumber = `INV-${Date.now()}`;
    const result = await pool.query(
      'INSERT INTO invoices (invoice_number, shipment_id, customer_id, amount, currency, due_date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [invoiceNumber, shipmentId, customerId, amount, currency || 'NGN', dueDate, notes]
    );
    const invoice = result.rows[0];

    
    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'CREATE_INVOICE',
      'invoice',
      invoice.id,
      { amount, currency, invoiceNumber }
    );

    res.json({ success: true, data: mapInvoice(invoice) });
  } catch (err) { next(err); }
});


router.put('/:id/status', adminMiddleware, async (req, res, next) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
    const result = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);

    
    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'UPDATE_INVOICE_STATUS',
      'invoice',
      req.params.id,
      { status }
    );

    res.json({ success: true, data: mapInvoice(result.rows[0]) });
  } catch (err) { next(err); }
});


router.put('/:id/reminder', adminMiddleware, async (req, res, next) => {
  try {
    const { followUpDate } = req.body;
    await pool.query('UPDATE invoices SET follow_up_date = $1, updated_at = NOW() WHERE id = $2', [followUpDate || null, req.params.id]);
    const result = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);

    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'UPDATE_INVOICE_REMINDER',
      'invoice',
      req.params.id,
      { followUpDate }
    );

    res.json({ success: true, data: mapInvoice(result.rows[0]) });
  } catch (err) { next(err); }
});


// Body: { amount, paymentMethod, notes? }. Money is validated as a decimal string and summed in SQL
// NUMERIC (payments.amount / invoices.amount are DECIMAL(15,2)); no JS float arithmetic.
const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;
const PAYMENT_METHODS = ['paystack', 'stripe', 'manual'];
const INVOICE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.put('/:id/payment', adminMiddleware, async (req, res, next) => {
  const { amount, paymentMethod, notes } = req.body;
  const amountText = typeof amount === 'number' || typeof amount === 'string' ? String(amount).trim() : '';
  if (!AMOUNT_RE.test(amountText) || Number(amountText) <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be a positive number with at most 2 decimal places' });
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ success: false, message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(', ')}` });
  }
  if (!INVOICE_UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'Invoice not found' });

  let client;
  try {
    client = await pool.connect();
  } catch (err) { return next(err); }
  let invoice;
  let settlement;
  try {
    await client.query('BEGIN');

    // Serialises payments on the same invoice: a concurrent payment waits, then sees the new total.
    const locked = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (locked.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    invoice = locked.rows[0];
    if (invoice.status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Invoice is already fully paid' });
    }

    const balance = await client.query(
      `SELECT (i.amount - COALESCE(SUM(p.amount) FILTER (WHERE p.payment_status = 'success'), 0))::text AS outstanding,
              $2::numeric > (i.amount - COALESCE(SUM(p.amount) FILTER (WHERE p.payment_status = 'success'), 0)) AS exceeds
         FROM invoices i
         LEFT JOIN payments p ON p.invoice_id = i.id
        WHERE i.id = $1
        GROUP BY i.id, i.amount`,
      [invoice.id, amountText]
    );
    if (balance.rows[0].exceeds) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Payment exceeds the outstanding balance of ${balance.rows[0].outstanding} ${invoice.currency}`,
        outstanding: balance.rows[0].outstanding,
      });
    }

    await client.query(
      `INSERT INTO payments (invoice_id, customer_id, amount, currency, payment_method, payment_status, paid_at)
       VALUES ($1, $2, $3::numeric, $4, $5, 'success', NOW())`,
      [invoice.id, invoice.customer_id, amountText, invoice.currency, paymentMethod]
    );

    const totals = await client.query(
      `SELECT COALESCE(SUM(p.amount), 0)::text AS paid_total,
              (i.amount - COALESCE(SUM(p.amount), 0))::text AS outstanding,
              COALESCE(SUM(p.amount), 0) >= i.amount AS fully_paid
         FROM invoices i
         LEFT JOIN payments p ON p.invoice_id = i.id AND p.payment_status = 'success'
        WHERE i.id = $1
        GROUP BY i.id, i.amount`,
      [invoice.id]
    );
    settlement = totals.rows[0];

    await client.query('UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2', [
      settlement.fully_paid ? 'paid' : 'part_paid',
      invoice.id,
    ]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }

  try {
    const updatedInvoiceResult = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoice.id]);
    const updated = updatedInvoiceResult.rows[0];

    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'RECORD_INVOICE_PAYMENT',
      'invoice',
      invoice.id,
      {
        amount: amountText,
        paymentMethod,
        notes,
        previousStatus: invoice.status,
        newStatus: updated.status,
        paidTotal: settlement.paid_total,
        outstanding: settlement.outstanding,
      }
    );

    // Same row as before, plus decimal strings so callers never lose precision.
    res.json({ success: true, data: { ...updated, amountPaid: settlement.paid_total, outstanding: settlement.outstanding } });
  } catch (err) { next(err); }
});


router.get('/:id/pdf', adminMiddleware, async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${req.params.id}.pdf`);
    res.send('PDF content placeholder');
  } catch (err) { next(err); }
});


router.delete('/:id', adminMiddleware, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);

    
    await logAuditEvent(
      req.admin!.id,
      'admin',
      req.admin!.activeRole,
      'DELETE_INVOICE',
      'invoice',
      req.params.id
    );

    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) { next(err); }
});

export default router;
