import { Router } from 'express';
import { z } from 'zod';
import pool from '../../config/db';
import { adminMiddleware } from '../../middleware/adminMiddleware';
import { CROSS_READS, moduleGuard, roleHasModule, requireActiveAdmin } from '../../middleware/permissions';
import { insertAuditEvent, logAuditEvent } from '../../utils/audit';
import { emit } from '../notifications/notification.service';
import { sendEmail } from '../../utils/sendEmail';

const router = Router();

router.use(adminMiddleware, requireActiveAdmin, moduleGuard('communications', [{ method: 'GET', path: '/:customerId', anyOf: CROSS_READS.communicationsThread }]));
const uuidSchema = z.string().uuid();
const messageSchema = z.object({
  customerId: uuidSchema,
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(10000),
});

const customerExists = async (customerId: string) => {
  const result = await pool.query('SELECT id FROM customers WHERE id = $1', [customerId]);
  return result.rows.length > 0;
};

router.get('/', adminMiddleware, async (req, res, next) => {
  try {
    const { search, filter, sortBy, industry } = req.query;
    let sql = `
      SELECT c.id, c.firstname, c.lastname, c.email, c.industry,
        (SELECT COUNT(*) FROM communications WHERE customer_id = c.id AND sender_type = 'customer' AND read_by_admin = false) as unread_count,
        (SELECT body FROM communications WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM communications WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at
      FROM customers c
      WHERE EXISTS (SELECT 1 FROM communications WHERE customer_id = c.id)
    `;
    const params: any[] = [];
    let paramIdx = 1;
    if (filter === 'unread') {
      sql += ` AND EXISTS (SELECT 1 FROM communications WHERE customer_id = c.id AND sender_type = 'customer' AND read_by_admin = false)`;
    }
    if (industry && industry !== 'all') {
      sql += ` AND c.industry = $${paramIdx}`;
      params.push(industry);
      paramIdx++;
    }
    if (search) {
      sql += ` AND (c.firstname ILIKE $${paramIdx} OR c.lastname ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx} OR EXISTS (SELECT 1 FROM communications WHERE customer_id = c.id AND subject ILIKE $${paramIdx}))`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    sql += sortBy === 'oldest' ? ' ORDER BY last_message_at ASC' : ' ORDER BY last_message_at DESC';
    const result = await pool.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

router.get('/:customerId', adminMiddleware, async (req, res, next) => {
  try {
    if (!uuidSchema.safeParse(req.params.customerId).success || !(await customerExists(req.params.customerId))) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const result = await pool.query(
      `SELECT *, sender_type AS "senderType", (sender_type = 'customer') AS "sentByCustomer"
       FROM communications WHERE customer_id = $1 ORDER BY created_at ASC`,
      [req.params.customerId]
    );
    // Cross-module readers (e.g. finance via CustomerDetail) see the thread read-only; only roles that
    // work the communications inbox mark customer messages, and their own message notifications, as read.
    if (roleHasModule(req.admin!.activeRole, 'communications')) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE communications SET read_by_admin = true
           WHERE customer_id = $1 AND sender_type = 'customer' AND read_by_admin = false`,
          [req.params.customerId]
        );
        await client.query(
          `UPDATE notifications SET read_at = NOW()
           WHERE admin_id = $1 AND type = 'message.received' AND entity_type = 'customer_thread'
             AND entity_id = $2 AND read_at IS NULL`,
          [req.admin!.id, req.params.customerId]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

router.post('/send', adminMiddleware, async (req, res, next) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.flatten().fieldErrors });
  }
  const { customerId, subject, body } = parsed.data;

  let client;
  try {
    client = await pool.connect();
  } catch (err) { return next(err); }
  let customer;
  let comm;
  try {
    await client.query('BEGIN');
    const custResult = await client.query('SELECT firstname, email FROM customers WHERE id = $1', [customerId]);
    if (custResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    customer = custResult.rows[0];

    const result = await client.query(
      `INSERT INTO communications (customer_id, sent_by, sender_type, subject, body, read_by_admin, read_by_customer)
       VALUES ($1, $2, 'admin', $3, $4, true, false)
       RETURNING *, sender_type AS "senderType", false AS "sentByCustomer"`,
      [customerId, req.admin!.id, subject, body]
    );
    comm = result.rows[0];

    await insertAuditEvent(client, req.admin!.id, 'admin', req.admin!.activeRole, 'SEND_COMMUNICATION', 'communication', comm.id, { customerId, subject });
    await emit(
      { type: 'message.received', actor: { type: 'admin', id: req.admin!.id }, sourceId: comm.id, customerId, direction: 'to_customer', text: body },
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
  const emailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2>New Message from VHI</h2>
        <p>Hello ${customer.firstname},</p>
        <p>You have received a new message from our support team.</p>
        <blockquote style="border-left: 4px solid #eee; padding-left: 10px; margin-left: 0;">
          ${body.replace(/\n/g, '<br>')}
        </blockquote>
        <p><a href="${process.env.CLIENT_FRONTEND_URL}/messages" style="display: inline-block; padding: 10px 20px; background: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">View and Reply in Portal</a></p>
      </div>
    `;
  sendEmail(customer.email, subject || 'New Message from VHI Support', emailHtml).catch(console.error);

  res.status(201).json({ success: true, data: comm });
});

router.delete('/:messageId', adminMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM communications WHERE id = $1 RETURNING id', [req.params.messageId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Message not found' });
    await logAuditEvent(req.admin!.id, 'admin', req.admin!.activeRole, 'DELETE_COMMUNICATION', 'communication', req.params.messageId);
    res.json({ success: true, message: 'Message deleted' });
  } catch (err) { next(err); }
});

export default router;
