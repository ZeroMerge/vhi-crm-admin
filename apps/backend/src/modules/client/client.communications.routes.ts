import { Router } from 'express';
import { z } from 'zod';
import pool from '../../config/db';
import { customerMiddleware } from '../../middleware/customerMiddleware';
import { emit } from '../notifications/notification.service';
import { publishRealtime } from '../notifications/realtime';
import { markThreadRead, marksOnGet, messageCreatedEvents, parseIdsParam, readBodySchema } from '../communications/threadRealtime';

const router = Router();
const messageSchema = z.object({
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(10000),
});

const THREAD_COLUMNS = `*, sender_type AS "senderType", (sender_type = 'customer') AS "sentByCustomer"`;

router.get('/', customerMiddleware, async (req, res, next) => {
  const customerId = req.customer!.id;
  const idsParam = parseIdsParam(req.query.ids);
  if (!idsParam.ok) return res.status(400).json({ success: false, message: idsParam.message });
  // ?ids= (Phase 5): only the caller's own messages among those ids; others are silently left out. Never marks anything.
  // ?markRead=false: the whole thread, read-only. New UIs send one of these; the default below is the legacy mark-on-GET.
  if (idsParam.ids || !marksOnGet(req.query.markRead)) {
    try {
      const result = idsParam.ids
        ? await pool.query(`SELECT ${THREAD_COLUMNS} FROM communications WHERE customer_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at ASC, id`, [customerId, idsParam.ids])
        : await pool.query(`SELECT ${THREAD_COLUMNS} FROM communications WHERE customer_id = $1 ORDER BY created_at ASC`, [customerId]);
      return res.json({ success: true, data: result.rows });
    } catch (err) {
      return next(err);
    }
  }
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
    // Legacy (kept for one release, RISKS R-68): opening Mail reads the thread: mark admin messages and their in-app notifications read together.
    await client.query('BEGIN');
    await client.query(
      `UPDATE communications SET read_by_customer = true
       WHERE customer_id = $1 AND sender_type = 'admin' AND read_by_customer = false`,
      [customerId]
    );
    const read = await client.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE customer_id = $1 AND type = 'message.received' AND entity_type = 'customer_thread'
         AND entity_id = $1 AND read_at IS NULL
       RETURNING id`,
      [customerId]
    );
    if (read.rows.length > 0) {
      await publishRealtime(
        [{ kind: 'read', recipientType: 'customer', recipientId: customerId, notificationIds: read.rows.map((r) => String(r.id)) }],
        client
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// Phase 5: marks exactly the admin messages the customer has seen (the ids rendered), never by cursor or time.
router.post('/read', customerMiddleware, async (req, res, next) => {
  const parsed = readBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.flatten().fieldErrors });
  }
  const customerId = req.customer!.id;
  let client;
  try {
    client = await pool.connect();
  } catch (err) { return next(err); }
  try {
    await client.query('BEGIN');
    const result = await markThreadRead(client, { customerId, readerSide: 'customer', readerId: customerId, messageIds: parsed.data.messageIds });
    await client.query('COMMIT');
    res.json({ success: true, data: { updated: result.updated } });
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
      { type: 'message.received', actor: { type: 'customer', id: customerId }, sourceId: message.id, customerId, direction: 'to_admins', text: body, subject },
      client
    );
    // Live chat (Phase 5): ids only, delivered on COMMIT to the customer's other tabs and to communications admins.
    await publishRealtime(messageCreatedEvents(customerId, message.id, 'customer'), client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }

  // The support-inbox email was enqueued by emit() in the same transaction (email outbox, Phase 3).
  res.status(201).json({ success: true, data: message });
});

export default router;
