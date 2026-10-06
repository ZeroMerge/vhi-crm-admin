import { Router } from 'express';
import { z } from 'zod';
import pool from '../../config/db';
import { customerMiddleware } from '../../middleware/customerMiddleware';
import { sendEmail } from '../../utils/sendEmail';
import { emit } from '../notifications/notification.service';

const router = Router();
const messageSchema = z.object({
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(10000),
});

router.get('/', customerMiddleware, async (req, res, next) => {
  const customerId = req.customer!.id;
  let client;
  try {
    client = await pool.connect();
  } catch (err) { return next(err); }
  try {
    const result = await client.query(
      `SELECT *, sender_type AS "senderType", (sender_type = 'customer') AS "sentByCustomer"
       FROM communications WHERE customer_id = $1 ORDER BY created_at ASC`,
      [customerId]
    );
    // Opening Mail reads the thread: mark admin messages and their in-app notifications read together.
    await client.query('BEGIN');
    await client.query(
      `UPDATE communications SET read_by_customer = true
       WHERE customer_id = $1 AND sender_type = 'admin' AND read_by_customer = false`,
      [customerId]
    );
    await client.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE customer_id = $1 AND type = 'message.received' AND entity_type = 'customer_thread'
         AND entity_id = $1 AND read_at IS NULL`,
      [customerId]
    );
    await client.query('COMMIT');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

router.get('/unread-count', customerMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM communications
       WHERE customer_id = $1 AND sender_type = 'admin' AND read_by_customer = false`,
      [req.customer!.id]
    );
    res.json({ success: true, data: { count: result.rows[0].count }, count: result.rows[0].count });
  } catch (err) { next(err); }
});

router.post('/send', customerMiddleware, async (req, res, next) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.flatten().fieldErrors });
  }
  const customerId = req.customer!.id;
  const { subject, body } = parsed.data;

  let client;
  try {
    client = await pool.connect();
  } catch (err) { return next(err); }
  let customer;
  let message;
  try {
    await client.query('BEGIN');
    const customerResult = await client.query('SELECT id, firstname, lastname, email FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    customer = customerResult.rows[0];

    const result = await client.query(
      `INSERT INTO communications (customer_id, sent_by_customer, sender_type, subject, body, read_by_admin, read_by_customer)
       VALUES ($1, $1, 'customer', $2, $3, false, true)
       RETURNING *, sender_type AS "senderType", true AS "sentByCustomer"`,
      [customerId, subject, body]
    );
    message = result.rows[0];

    await emit(
      { type: 'message.received', actor: { type: 'customer', id: customerId }, sourceId: message.id, customerId, direction: 'to_admins', text: body },
      client
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }

  // Email only after the message is committed (never from inside the transaction).
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
  if (supportEmail) {
    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2>New Message from Customer</h2>
        <p><strong>Customer:</strong> ${customer.firstname} ${customer.lastname} (${customer.email})</p>
        <p>You have received a new message in the CRM communications channel.</p>
        <blockquote style="border-left: 4px solid #eee; padding-left: 10px; margin-left: 0;">
          ${body.replace(/\n/g, '<br>')}
        </blockquote>
        <p><a href="${process.env.ADMIN_FRONTEND_URL}/admin/communications?selected=${customerId}" style="display: inline-block; padding: 10px 20px; background: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">View and Reply in Admin Portal</a></p>
      </div>
    `;
    sendEmail(supportEmail, `New Message from ${customer.firstname} ${customer.lastname}`, emailHtml).catch(console.error);
  }

  res.status(201).json({ success: true, data: message });
});

export default router;
