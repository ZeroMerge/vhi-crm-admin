import { Router } from 'express';
import pool from '../../config/db';
import { customerMiddleware } from '../../middleware/customerMiddleware';

const router = Router();

router.get('/:orderId', customerMiddleware, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const customerId = req.customer!.id;

    const shipmentResult = await pool.query(
      `SELECT s.id, s.order_id, s.status, s.created_at,
              s.shipping_mode, s.delivery_mode, s.nature_of_item,
              s.origin_address, s.destination_address,
              s.weight_unit,
              COALESCE(SUM(si.weight), 0) AS total_weight
       FROM shipments s
       LEFT JOIN shipment_items si ON si.shipment_id = s.id
       WHERE s.order_id = $1 AND s.customer_id = $2
       GROUP BY s.id`,
      [orderId, customerId]
    );

    if (shipmentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Shipment not found' });
    }

    const row = shipmentResult.rows[0];

    const trackingResult = await pool.query(
      'SELECT status, message, created_at FROM tracking_updates WHERE shipment_id = $1 ORDER BY created_at ASC',
      [row.id]
    );

    res.json({
      success: true,
      data: {
        orderId:            row.order_id,
        status:             row.status,
        createdAt:          row.created_at,
        shippingMode:       row.shipping_mode,
        deliveryMode:       row.delivery_mode,
        natureOfItem:       row.nature_of_item,
        originAddress:      row.origin_address,
        destinationAddress: row.destination_address,
        totalWeight:        parseFloat(row.total_weight),
        weightUnit:         row.weight_unit,
        trackingUpdates:    trackingResult.rows.map(t => ({
          status:    t.status,
          message:   t.message,
          createdAt: t.created_at,
        })),
      },
    });
  } catch (err) { next(err); }
});

export default router;
