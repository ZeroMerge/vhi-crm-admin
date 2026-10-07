// /api/email/unsubscribe: GET shows a confirmation page and NEVER changes anything (mail security scanners prefetch links);
// POST (the page's button, or a provider's RFC 8058 one-click request) turns the preference off. Idempotent.
import { Router, Response } from 'express';
import pool from '../../config/db';
import { emailConfig } from '.';
import { verifyUnsubscribeToken } from './unsubscribeToken';
import { links } from './templates/urls';
import { maskEmail } from './templates/html';
import { unsubscribeConfirmPage, unsubscribeDonePage, unsubscribeInvalidPage } from './templates/pages';
import { insertAuditEvent } from '../../utils/audit';
import { normaliseCustomerPrefs } from './preferences';

const router = Router();

function sendPage(res: Response, status: number, markup: string) {
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', // the token is in the URL
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    })
    .send(markup);
}

const tokenFrom = (value: unknown) => (typeof value === 'string' ? value : null);

router.get('/unsubscribe', async (req, res, next) => {
  try {
    const cfg = emailConfig();
    const settingsUrl = links(cfg.bases).clientSettings();
    const token = tokenFrom(req.query.token);
    const claim = verifyUnsubscribeToken(token, cfg.linkSecret);
    if (!claim) return sendPage(res, 400, unsubscribeInvalidPage({ settingsUrl }));
    const { rows } = await pool.query('SELECT email FROM customers WHERE id = $1', [claim.customerId]);
    if (!rows[0]) return sendPage(res, 400, unsubscribeInvalidPage({ settingsUrl }));
    // Relative action: the page is served by this API, whatever host name it was reached on.
    const actionUrl = `/api/email/unsubscribe?token=${encodeURIComponent(token!)}`;
    sendPage(res, 200, unsubscribeConfirmPage({ maskedEmail: maskEmail(rows[0].email), actionUrl, settingsUrl }));
  } catch (err) {
    next(err);
  }
});

router.post('/unsubscribe', async (req, res, next) => {
  try {
    const cfg = emailConfig();
    const settingsUrl = links(cfg.bases).clientSettings();
    const token = tokenFrom(req.query.token) ?? tokenFrom(req.body?.token);
    const claim = verifyUnsubscribeToken(token, cfg.linkSecret);
    if (!claim) return sendPage(res, 400, unsubscribeInvalidPage({ settingsUrl }));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT notification_prefs FROM customers WHERE id = $1 FOR UPDATE', [claim.customerId]);
      if (current.rows.length === 0) {
        await client.query('ROLLBACK');
        return sendPage(res, 400, unsubscribeInvalidPage({ settingsUrl }));
      }
      // Idempotent: a second POST (or a provider retry) finds the preference already off and changes nothing.
      if (normaliseCustomerPrefs(current.rows[0].notification_prefs)[claim.prefKey]) {
        await client.query(
          `UPDATE customers SET notification_prefs = jsonb_set(notification_prefs, $2::text[], 'false'::jsonb) WHERE id = $1`,
          [claim.customerId, `{${claim.prefKey}}`]
        );
        await insertAuditEvent(client, claim.customerId, 'customer', null, 'EMAIL_UNSUBSCRIBE', 'customer', claim.customerId, { prefKey: claim.prefKey });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    sendPage(res, 200, unsubscribeDonePage({ settingsUrl }));
  } catch (err) {
    next(err);
  }
});

export default router;
