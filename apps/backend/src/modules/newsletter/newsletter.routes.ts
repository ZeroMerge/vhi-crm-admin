import { Router } from 'express';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';

const router = Router();


router.get('/segments', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT industry, COUNT(*) as count, 
        JSON_AGG(JSON_BUILD_OBJECT('id', id, 'firstname', firstname, 'lastname', lastname, 'email', email)) as customers
      FROM customers GROUP BY industry ORDER BY industry`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});


router.put('/segments/move', adminMiddleware, async (req, res, next) => {
  try {
    const { customerId, toIndustry } = req.body;
    await pool.query('UPDATE customers SET industry = $1 WHERE id = $2', [toIndustry, customerId]);
    res.json({ success: true, message: 'Customer moved to new segment' });
  } catch (err) { next(err); }
});


router.delete('/segments/remove', adminMiddleware, async (req, res, next) => {
  try {
    const { customerId } = req.body;
    await pool.query('UPDATE customers SET industry = NULL WHERE id = $1', [customerId]);
    res.json({ success: true, message: 'Customer removed from segment' });
  } catch (err) { next(err); }
});


router.post('/send', adminMiddleware, async (req, res, next) => {
  try {
    const { subject, body, segments } = req.body;
    let customerIds: string[] = [];

    if (segments.includes('all')) {
      const result = await pool.query('SELECT id FROM customers');
      customerIds = result.rows.map((r) => r.id);
    } else {
      const result = await pool.query('SELECT id FROM customers WHERE industry = ANY($1)', [segments]);
      customerIds = result.rows.map((r) => r.id);
    }

    await pool.query(
      'INSERT INTO newsletter_sends (subject, body, segment, sent_by, recipient_count) VALUES ($1, $2, $3, $4, $5)',
      [subject, body, segments.join(','), req.admin!.id, customerIds.length]
    );

    res.json({ success: true, message: `Newsletter sent to ${customerIds.length} recipients` });
  } catch (err) { next(err); }
});


router.get('/history', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM newsletter_sends ORDER BY sent_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

export default router;
