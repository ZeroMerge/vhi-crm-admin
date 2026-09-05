import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import pool from '../../config/db';
import { customerMiddleware } from '../../middleware/customerMiddleware';
import { logAuditEvent } from '../../utils/audit';
import { uploadToCloudinary } from '../../utils/uploadToCloudinary';

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

const cargoClearingSchema = z.object({
  clearingType:     z.enum(['air_clearing', 'sea_clearing']),
  description:      z.string().min(1, 'description is required'),
  awbNumber:        z.string().optional().nullable(),
  invoiceValue:     z.coerce.number().nonnegative().default(0),
  invoiceCurrency:  z.string().default('NGN'),
  commodityHsCode:  z.string().optional().nullable(),
  weight:           z.coerce.number().nonnegative().optional().nullable(),
  weightUnit:       z.string().default('kg'),
  deliveryMode:     z.string().optional().nullable(),
  deliveryAddress:  z.string().optional().nullable(),
});

// Client-owned fields only, all optional (used for partial updates on pending clearings)
const cargoClearingUpdateSchema = z.object({
  clearingType:     z.enum(['air_clearing', 'sea_clearing']).optional(),
  description:      z.string().min(1, 'description is required').optional(),
  awbNumber:        z.string().optional().nullable(),
  invoiceValue:     z.coerce.number().nonnegative().optional(),
  invoiceCurrency:  z.string().optional(),
  commodityHsCode:  z.string().optional().nullable(),
  weight:           z.coerce.number().nonnegative().optional().nullable(),
  weightUnit:       z.string().optional(),
  deliveryMode:     z.string().optional().nullable(),
  deliveryAddress:  z.string().optional().nullable(),
});

const cargoClearingUpdateColumnMap: Record<string, string> = {
  clearingType:     'clearing_type',
  description:      'description',
  awbNumber:        'awb_number',
  invoiceValue:     'invoice_value',
  invoiceCurrency:  'invoice_currency',
  commodityHsCode:  'commodity_hs_code',
  weight:           'weight',
  weightUnit:       'weight_unit',
  deliveryMode:     'delivery_mode',
  deliveryAddress:  'delivery_address',
};

router.get('/', customerMiddleware, async (req, res, next) => {
  try {
    const { page = '1', pageSize = '10' } = req.query;
    const customerId = req.customer!.id;
    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM cargo_clearings WHERE customer_id = $1',
      [customerId]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      'SELECT * FROM cargo_clearings WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [customerId, pageSizeNum, (pageNum - 1) * pageSizeNum]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil(total / pageSizeNum),
      },
    });
  } catch (err) { next(err); }
});

router.post(
  '/',
  customerMiddleware,
  upload.fields([
    { name: 'airwayBill', maxCount: 1 },
    { name: 'finalInvoice', maxCount: 1 },
  ]),
  async (req, res, next) => {
    // Step 1: Validate fields
    const fieldsParsed = cargoClearingSchema.safeParse(req.body);
    if (!fieldsParsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: fieldsParsed.error.flatten().fieldErrors,
      });
    }
    const fields = fieldsParsed.data;

    // Step 2: Upload files to Cloudinary — abort on any failure, no DB writes
    const files = (req.files as { [field: string]: Express.Multer.File[] }) ?? {};
    const airwayBillFile = files.airwayBill?.[0];
    const finalInvoiceFile = files.finalInvoice?.[0];

    let airwayBillUrl: string | null = null;
    let finalInvoiceUrl: string | null = null;

    try {
      if (airwayBillFile) {
        airwayBillUrl = (await uploadToCloudinary(airwayBillFile)).url;
      }
      if (finalInvoiceFile) {
        finalInvoiceUrl = (await uploadToCloudinary(finalInvoiceFile)).url;
      }
    } catch (err) {
      return res.status(400).json({ success: false, message: 'File upload failed. No cargo clearing was created.' });
    }

    try {
      const customerId = req.customer!.id;

      const result = await pool.query(
        `INSERT INTO cargo_clearings (
          customer_id, clearing_type, description, awb_number,
          invoice_value, invoice_currency, commodity_hs_code,
          weight, weight_unit, delivery_mode, delivery_address,
          status, airway_bill_url, final_invoice_url
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING *`,
        [
          customerId,
          fields.clearingType,
          fields.description,
          fields.awbNumber ?? null,
          fields.invoiceValue,
          fields.invoiceCurrency,
          fields.commodityHsCode ?? null,
          fields.weight ?? null,
          fields.weightUnit,
          fields.deliveryMode ?? null,
          fields.deliveryAddress ?? null,
          'pending',
          airwayBillUrl,
          finalInvoiceUrl,
        ]
      );

      const cargoClearing = result.rows[0];

      await logAuditEvent(customerId, 'customer', null, 'CREATE_CARGO_CLEARING', 'cargo_clearing', cargoClearing.id, {
        clearingType: fields.clearingType,
      });

      res.status(201).json({ success: true, data: cargoClearing });
    } catch (err) { next(err); }
  }
);

router.get('/:id', customerMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM cargo_clearings WHERE id = $1 AND customer_id = $2',
      [req.params.id, req.customer!.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cargo clearing not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

router.put('/:id', customerMiddleware, async (req, res, next) => {
  try {
    const customerId = req.customer!.id;
    const existing = await pool.query(
      'SELECT * FROM cargo_clearings WHERE id = $1 AND customer_id = $2',
      [req.params.id, customerId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cargo clearing not found' });
    }
    const cargoClearing = existing.rows[0];
    if (cargoClearing.status !== 'pending') {
      return res.status(403).json({ success: false, message: 'Cargo clearing cannot be modified after processing has begun' });
    }

    const fieldsParsed = cargoClearingUpdateSchema.safeParse(req.body);
    if (!fieldsParsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: fieldsParsed.error.flatten().fieldErrors,
      });
    }
    const fields = fieldsParsed.data;

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    for (const [key, column] of Object.entries(cargoClearingUpdateColumnMap)) {
      const value = (fields as Record<string, unknown>)[key];
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIdx}`);
        params.push(value);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) {
      return res.json({ success: true, data: cargoClearing });
    }

    setClauses.push('updated_at = NOW()');
    params.push(cargoClearing.id);

    const result = await pool.query(
      `UPDATE cargo_clearings SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params
    );
    const updated = result.rows[0];

    await logAuditEvent(customerId, 'customer', null, 'UPDATE_CARGO_CLEARING', 'cargo_clearing', updated.id, {});

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

router.delete('/:id', customerMiddleware, async (req, res, next) => {
  try {
    const customerId = req.customer!.id;
    const existing = await pool.query(
      'SELECT * FROM cargo_clearings WHERE id = $1 AND customer_id = $2',
      [req.params.id, customerId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cargo clearing not found' });
    }
    const cargoClearing = existing.rows[0];
    if (cargoClearing.status !== 'pending') {
      return res.status(403).json({ success: false, message: 'Cargo clearing cannot be modified after processing has begun' });
    }

    await pool.query(`UPDATE cargo_clearings SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [cargoClearing.id]);

    await logAuditEvent(customerId, 'customer', null, 'CANCEL_CARGO_CLEARING', 'cargo_clearing', cargoClearing.id, {});

    res.json({ success: true, message: 'Cargo clearing cancelled successfully' });
  } catch (err) { next(err); }
});

export default router;
