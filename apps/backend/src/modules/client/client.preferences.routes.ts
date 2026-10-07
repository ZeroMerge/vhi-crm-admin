// /api/client/notification-preferences — the signed-in customer's own email preferences (in-app notifications are always on).
import { Router } from 'express';
import pool from '../../config/db';
import { customerMiddleware } from '../../middleware/customerMiddleware';
import { customerPrefsUpdateSchema, normaliseCustomerPrefs } from '../email/preferences';

const router = Router();
router.use(customerMiddleware);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT notification_prefs FROM customers WHERE id = $1', [req.customer!.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, data: normaliseCustomerPrefs(rows[0].notification_prefs) });
  } catch (err) {
    next(err);
  }
});

// Body { shipment_updates: boolean }. Unknown keys or non-boolean values → 400. Merged into the saved preferences.
router.put('/', async (req, res, next) => {
  const parsed = customerPrefsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid notification preferences', errors: parsed.error.flatten() });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE customers SET notification_prefs = COALESCE(notification_prefs, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
        WHERE id = $1 RETURNING notification_prefs`,
      [req.customer!.id, JSON.stringify(parsed.data)]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, message: 'Email preferences saved', data: normaliseCustomerPrefs(rows[0].notification_prefs) });
  } catch (err) {
    next(err);
  }
});

export default router;
