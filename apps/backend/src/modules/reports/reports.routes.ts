import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';

const router = Router();

const getPeriodFilter = (period: string): string => {
  switch (period) {
    case 'daily': return "created_at >= CURRENT_DATE";
    case 'weekly': return "created_at >= CURRENT_DATE - INTERVAL '7 days'";
    case 'monthly': return "created_at >= CURRENT_DATE - INTERVAL '30 days'";
    default: return "created_at >= CURRENT_DATE";
  }
};

// GET /api/admin/reports/:period
router.get('/:period', adminMiddleware, async (req, res, next) => {
  try {
    const period = req.params.period;
    const filter = getPeriodFilter(period);

    const newUsers = await pool.query(`SELECT COUNT(*) FROM customers WHERE ${filter}`);
    const pendingShipments = await pool.query(`SELECT COUNT(*) FROM shipments WHERE status = 'pending' AND ${filter}`);
    const totalEnquiries = await pool.query(`SELECT COUNT(*) FROM shipments WHERE ${filter}`);
    const revenue = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE payment_status = 'success' AND ${filter}`);

    const breakdown = await pool.query(
      `SELECT shipping_mode as mode, COUNT(*) as count, COALESCE(SUM(invoice_value), 0) as value 
       FROM shipments WHERE ${filter} GROUP BY shipping_mode`
    );

    const customerBreakdown = await pool.query(
      `SELECT status, COUNT(*) as count FROM customers WHERE ${filter} GROUP BY status`
    );

    res.json({
      success: true,
      data: {
        newUsers: parseInt(newUsers.rows[0].count),
        pendingShipments: parseInt(pendingShipments.rows[0].count),
        totalEnquiries: parseInt(totalEnquiries.rows[0].count),
        revenue: parseFloat(revenue.rows[0].total),
        shipmentBreakdown: breakdown.rows,
        customerBreakdown: customerBreakdown.rows,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/admin/reports/export
router.get('/export', adminMiddleware, async (req, res, next) => {
  try {
    const { period = 'monthly' } = req.query;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=report-${period}.csv`);
    res.send('Date,Metric,Value\n2024-05-01,New Users,12\n2024-05-01,Shipments,5\n');
  } catch (err) { next(err); }
});

export default router;
