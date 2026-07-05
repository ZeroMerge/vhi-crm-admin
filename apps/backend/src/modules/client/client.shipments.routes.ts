import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import pool from '../../config/db';
import { customerMiddleware } from '../../middleware/customerMiddleware';
import { logAuditEvent } from '../../utils/audit';
import { generateOrderId } from '../../utils/generateOrderId';
import { uploadToCloudinary } from '../../utils/uploadToCloudinary';

const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

const shipmentSchema = z.object({
  shippingMode:       z.enum(['air_freight', 'groupage', 'consolidation', 'china_groupage', 'cargo_clearing', 'export']),
  deliveryMode:       z.string().min(1, 'deliveryMode is required'),
  natureOfItem:       z.string().min(1, 'natureOfItem is required'),
  originAddress:      z.string().min(1, 'originAddress is required'),
  destinationAddress: z.string().min(1, 'destinationAddress is required'),
  originEmail:        z.string().email().optional().nullable(),
  originPhone:        z.string().optional().nullable(),
  destinationEmail:   z.string().email().optional().nullable(),
  destinationPhone:   z.string().optional().nullable(),
  countryOfOrigin:    z.string().optional().nullable(),
  exWorkType:         z.string().optional().nullable(),
  invoiceValue:       z.coerce.number().nonnegative().default(0),
  invoiceCurrency:    z.string().default('NGN'),
});

const itemSchema = z.object({
  description:   z.string().min(1, 'item description is required'),
  category:      z.string().optional().nullable(),
  quantity:      z.coerce.number().int().positive().default(1),
  weight:        z.coerce.number().nonnegative().default(0),
  dimensionL:    z.coerce.number().nonnegative().optional().nullable(),
  dimensionW:    z.coerce.number().nonnegative().optional().nullable(),
  dimensionH:    z.coerce.number().nonnegative().optional().nullable(),
  dimensionUnit: z.enum(['mm', 'cm', 'inches']).default('cm'),
});

router.get('/', customerMiddleware, async (req, res, next) => {
  try {
    const { page = '1', pageSize = '10' } = req.query;
    const customerId = req.customer!.id;
    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM shipments WHERE customer_id = $1',
      [customerId]
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      'SELECT * FROM shipments WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
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
  upload.array('documents', 4),
  async (req, res, next) => {
    // Step 1: Validate shipment fields
    const fieldsParsed = shipmentSchema.safeParse(req.body);
    if (!fieldsParsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: fieldsParsed.error.flatten().fieldErrors,
      });
    }
    const fields = fieldsParsed.data;

    // Step 2: Parse and validate items JSON string
    let items: z.infer<typeof itemSchema>[] = [];
    if (req.body.items) {
      let rawItems: unknown;
      try {
        rawItems = JSON.parse(req.body.items);
      } catch {
        return res.status(400).json({ success: false, message: 'items must be a valid JSON string' });
      }

      if (!Array.isArray(rawItems)) {
        return res.status(400).json({ success: false, message: 'items must be an array' });
      }

      const itemsParsed = z.array(itemSchema).safeParse(rawItems);
      if (!itemsParsed.success) {
        return res.status(400).json({
          success: false,
          message: 'Invalid items',
          errors: itemsParsed.error.flatten(),
        });
      }
      items = itemsParsed.data;
    }

    // Step 3: Upload files to Cloudinary — abort on any failure, no DB writes
    const files = (req.files as Express.Multer.File[]) ?? [];
    let uploadedDocs: { url: string; publicId: string }[] = [];

    if (files.length > 0) {
      try {
        uploadedDocs = await Promise.all(files.map(uploadToCloudinary));
      } catch (err) {
        return res.status(400).json({ success: false, message: 'File upload failed. No shipment was created.' });
      }
    }

    // Steps 4–8: DB transaction
    const client = await pool.connect();
    try {
      const customerId = req.customer!.id;
      const orderId = generateOrderId('client');

      await client.query('BEGIN');

      // Step 5: INSERT shipment
      const shipmentResult = await client.query(
        `INSERT INTO shipments (
          order_id, customer_id, shipping_mode, delivery_mode, nature_of_item,
          invoice_value, invoice_currency,
          origin_address, destination_address,
          origin_email, origin_phone,
          destination_email, destination_phone,
          country_of_origin, ex_work_type,
          status, is_draft
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *`,
        [
          orderId, customerId,
          fields.shippingMode, fields.deliveryMode, fields.natureOfItem,
          fields.invoiceValue, fields.invoiceCurrency,
          fields.originAddress, fields.destinationAddress,
          fields.originEmail ?? null, fields.originPhone ?? null,
          fields.destinationEmail ?? null, fields.destinationPhone ?? null,
          fields.countryOfOrigin ?? null, fields.exWorkType ?? null,
          'pending', false,
        ]
      );

      const shipment = shipmentResult.rows[0];

      // Step 6: INSERT items
      for (const item of items) {
        await client.query(
          `INSERT INTO shipment_items
             (shipment_id, description, category, quantity, weight,
              dimension_l, dimension_w, dimension_h, dimension_unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            shipment.id,
            item.description,
            item.category ?? null,
            item.quantity,
            item.weight,
            item.dimensionL ?? null,
            item.dimensionW ?? null,
            item.dimensionH ?? null,
            item.dimensionUnit,
          ]
        );
      }

      // Step 7: INSERT documents
      for (const doc of uploadedDocs) {
        await client.query(
          `INSERT INTO shipment_documents
             (shipment_id, file_url, cloudinary_public_id, uploaded_by)
           VALUES ($1, $2, $3, $4)`,
          [shipment.id, doc.url, doc.publicId, 'client']
        );
      }

      // Step 8: COMMIT
      await client.query('COMMIT');

      // Step 9: Audit
      await logAuditEvent(customerId, 'customer', null, 'CREATE_SHIPMENT', 'shipment', shipment.id, { orderId });

      // Step 10: Return 201
      res.status(201).json({ success: true, data: shipment });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

export default router;
