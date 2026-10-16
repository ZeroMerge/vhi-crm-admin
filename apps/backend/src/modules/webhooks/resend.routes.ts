// POST /api/webhooks/resend: bounce and complaint events from Resend (Svix-signed). Mounted in src/index.ts BEFORE CORS and
// express.json(): the signature covers the exact raw body, so this router parses it itself.
//
// - No RESEND_WEBHOOK_SECRET (dev / console provider) → 503 and nothing is processed. Unsigned requests are never accepted.
// - Bad or missing signature → 401/400. Timestamps more than 5 minutes off (old or future) → 400.
// - A replayed svix-id → 200, processed once only (processed_webhooks).
// - email.bounced (Permanent): suppress the address (bounce), alert customer-contact staff for a matching customer, log for an admin.
//   email.bounced (Transient): log only. email.complained: suppress (complaint; never downgrades a bounce) and switch the
//   customer's shipment update emails off. Anything else → 200, ignored.
import express, { Router } from 'express';
import type { PoolClient } from 'pg';
import pool from '../../config/db';
import { emailConfig } from '../email';
import { emit } from '../notifications/notification.service';
import { verifyWebhook, webhookKey } from './signature';

const router = Router();

interface ResendEvent {
  type?: unknown;
  data?: { to?: unknown; bounce?: { type?: unknown } };
}

const addressesOf = (to: unknown): string[] => {
  const list = Array.isArray(to) ? to : typeof to === 'string' ? [to] : [];
  return [...new Set(list.filter((a): a is string => typeof a === 'string' && a.includes('@')).map((a) => a.trim().toLowerCase()))];
};

async function suppress(client: PoolClient, address: string, reason: 'bounce' | 'complaint', eventId: string) {
  // A bounce overrides a complaint; a complaint never replaces a bounce.
  await client.query(
    `INSERT INTO email_suppressions (address, reason, source_event_id) VALUES ($1, $2, $3)
     ON CONFLICT (address) DO UPDATE SET reason = 'bounce', created_at = NOW(), source_event_id = EXCLUDED.source_event_id
       WHERE EXCLUDED.reason = 'bounce' AND email_suppressions.reason <> 'bounce'`,
    [address, reason, eventId]
  );
}

async function handleEvent(client: PoolClient, eventId: string, event: ResendEvent): Promise<string> {
  const type = typeof event.type === 'string' ? event.type : '';
  const addresses = addressesOf(event.data?.to);
  if (type === 'email.bounced') {
    const bounceType = String(event.data?.bounce?.type ?? '').toLowerCase();
    if (bounceType !== 'permanent') {
      console.log(`[webhooks] resend ${eventId}: transient bounce for ${addresses.length} address(es), not suppressed`);
      return 'transient bounce';
    }
    for (const address of addresses) {
      await suppress(client, address, 'bounce', eventId);
      const customers = await client.query('SELECT id, email FROM customers WHERE lower(email) = $1', [address]);
      for (const c of customers.rows) {
        await emit({ type: 'email.bounced', actor: { type: 'system', id: null }, sourceId: `${eventId}:${c.id}`, customerId: c.id, email: c.email }, client);
      }
      const admins = await client.query('SELECT id FROM admins WHERE lower(email) = $1', [address]);
      for (const a of admins.rows) console.warn(`[webhooks] resend ${eventId}: email to admin ${a.id} bounced; address suppressed`);
    }
    return `bounce: ${addresses.length} address(es) suppressed`;
  }
  if (type === 'email.complained') {
    for (const address of addresses) {
      await suppress(client, address, 'complaint', eventId);
      await client.query(
        `UPDATE customers SET notification_prefs = notification_prefs || '{"shipment_updates": false}'::jsonb, updated_at = NOW()
          WHERE lower(email) = $1`,
        [address]
      );
    }
    return `complaint: ${addresses.length} address(es) suppressed`;
  }
  return `ignored ${type || 'unknown'} event`;
}

router.post('/resend', express.raw({ type: '*/*', limit: '256kb' }), async (req, res, next) => {
  try {
    const secret = emailConfig().resendWebhookSecret;
    if (!secret) {
      return res.status(503).json({ success: false, message: 'Webhook signing secret is not configured' });
    }
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const id = req.get('svix-id');
    const verified = verifyWebhook({ key: webhookKey(secret), id, timestamp: req.get('svix-timestamp'), signature: req.get('svix-signature'), body });
    if (!verified.ok) {
      console.warn(`[webhooks] resend rejected: ${verified.reason}`);
      return res.status(verified.status).json({ success: false, message: 'Invalid webhook signature' });
    }

    let event: ResendEvent;
    try {
      event = JSON.parse(body.toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid JSON' });
    }
    if (typeof event !== 'object' || event === null) return res.status(400).json({ success: false, message: 'Invalid event' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fresh = await client.query(`INSERT INTO processed_webhooks (id, provider) VALUES ($1, 'resend') ON CONFLICT (id) DO NOTHING`, [id]);
      if (fresh.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.json({ success: true, duplicate: true });
      }
      const summary = await handleEvent(client, id!, event);
      await client.query('COMMIT');
      console.log(`[webhooks] resend ${id}: ${summary}`);
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err; // 500: Resend retries the delivery, and the id was not recorded
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

export default router;
