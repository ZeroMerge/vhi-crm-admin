// In-process email worker: claims due rows from email_deliveries, re-checks the recipient and preferences at send time,
// renders the template and sends through the provider. Started with the server, stopped on shutdown (src/index.ts).
import type { Pool } from 'pg';
import type { EmailConfig } from './config';
import { EmailProvider, EmailSendError } from './provider';
import { EMAIL_TEMPLATES, EmailKind, isEmailKind, renderTemplate, templateContext } from './templates';
import { normaliseAdminPrefs, normaliseCustomerPrefs } from './preferences';
import { createUnsubscribeToken } from './unsubscribeToken';
import { links } from './templates/urls';
import { SENSITIVE_PARAMS } from './outbox';

/** Delay after the 1st..5th retryable failure; the 6th failure marks the row failed. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const STALE_LOCK_MS = 10 * 60_000;
export const POLL_MS = 30_000;

export interface DeliveryRow {
  id: string;
  kind: string;
  to_address: string;
  admin_id: string | null;
  customer_id: string | null;
  params: Record<string, unknown>;
  attempts: number;
  idempotency_key: string;
  created_at: Date;
}

type Outcome =
  | { status: 'sent'; providerMessageId: string }
  | { status: 'cancelled'; reason: string }
  | { status: 'retry'; delayMs: number; error: string; countAttempt: boolean }
  | { status: 'failed'; error: string };

export interface EmailWorkerDeps {
  pool: Pool;
  provider: EmailProvider;
  config: Pick<EmailConfig, 'from' | 'replyTo' | 'linkSecret' | 'bases' | 'concurrency'> & Partial<Pick<EmailConfig, 'brand'>>;
  /** Subscribe to wake-ups (LISTEN vhi_email); returns an unsubscribe function. */
  onWake?: (wake: () => void) => () => void;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
  pollMs?: number;
}

const truncate = (s: string, max = 1000) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const SECRET_KEYS_SQL = `ARRAY[${SENSITIVE_PARAMS.map((k) => `'${k}'`).join(', ')}]::text[]`;

export class EmailWorker {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly pollMs: number;
  private stopped = true; // not started, or stopped: no timers, no wake-ups
  private stopRequested = false; // set by stop(): a running drain finishes its current batch and returns
  private draining: Promise<void> | null = null;
  private again = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private dueTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: EmailWorkerDeps) {
    this.log = deps.log ?? console;
    this.pollMs = deps.pollMs ?? POLL_MS;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.stopRequested = false;
    this.unsubscribe = this.deps.onWake?.(() => this.wake()) ?? null;
    this.pollTimer = setInterval(() => this.wake(), this.pollMs);
    this.pollTimer.unref?.();
    this.wake();
  }

  /** Stops claiming new rows and waits (up to timeoutMs) for in-flight sends. Rows left in 'sending' are recovered later. */
  async stop(timeoutMs = 8_000) {
    this.stopped = true;
    this.stopRequested = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.dueTimer) clearTimeout(this.dueTimer);
    this.pollTimer = this.dueTimer = null;
    if (this.draining) await Promise.race([this.draining, new Promise((r) => setTimeout(r, timeoutMs).unref?.())]);
  }

  wake() {
    if (this.stopped) return;
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = this.drain()
      .catch((err) => this.log.error('[email] worker cycle failed', err))
      .finally(() => {
        this.draining = null;
        if (this.again && !this.stopped) {
          this.again = false;
          this.wake();
        }
      });
  }

  /** One full cycle: recover stale locks, send everything due, then arm a timer for the next due row. Also used by tests. */
  async drain(): Promise<void> {
    await this.recoverStale();
    for (;;) {
      const rows = await this.claim(this.deps.config.concurrency);
      if (rows.length === 0) break;
      await Promise.all(rows.map((row) => this.process(row)));
      if (this.stopRequested) return;
    }
    await this.armDueTimer();
  }

  private async recoverStale() {
    const { rowCount } = await this.deps.pool.query(
      `UPDATE email_deliveries SET status = 'queued', locked_at = NULL
        WHERE status = 'sending' AND locked_at < NOW() - make_interval(secs => $1::double precision / 1000)`,
      [STALE_LOCK_MS]
    );
    if (rowCount) this.log.warn(`[email] recovered ${rowCount} stale 'sending' row(s); they will be retried with the same idempotency key`);
  }

  async claim(limit: number): Promise<DeliveryRow[]> {
    const { rows } = await this.deps.pool.query(
      `UPDATE email_deliveries SET status = 'sending', locked_at = NOW(), attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM email_deliveries
           WHERE status = 'queued' AND send_after <= NOW() AND next_attempt_at <= NOW()
           ORDER BY id
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING id::text AS id, kind, to_address, admin_id, customer_id, params, attempts, idempotency_key::text AS idempotency_key, created_at`,
      [limit]
    );
    return rows;
  }

  private async armDueTimer() {
    if (this.stopped) return;
    const { rows } = await this.deps.pool.query(
      `SELECT EXTRACT(EPOCH FROM (MIN(GREATEST(send_after, next_attempt_at)) - NOW())) * 1000 AS ms
         FROM email_deliveries WHERE status = 'queued'`
    );
    if (this.dueTimer) clearTimeout(this.dueTimer);
    this.dueTimer = null;
    const ms = rows[0]?.ms === null || rows[0]?.ms === undefined ? null : Number(rows[0].ms);
    if (ms !== null && ms < this.pollMs) {
      this.dueTimer = setTimeout(() => this.wake(), Math.max(0, Math.ceil(ms)) + 50);
      this.dueTimer.unref?.();
    }
  }

  async process(row: DeliveryRow): Promise<Outcome> {
    let outcome: Outcome;
    try {
      outcome = await this.attempt(row);
    } catch (err) {
      outcome = { status: 'failed', error: `render/check error: ${(err as Error).message}` };
    }
    await this.record(row, outcome);
    this.log.info?.(`[email] ${row.id} ${row.kind} ${outcome.status}${outcome.status === 'retry' ? ` (attempt ${row.attempts})` : ''}`);
    return outcome;
  }

  private async attempt(row: DeliveryRow): Promise<Outcome> {
    if (!isEmailKind(row.kind)) return { status: 'failed', error: `unknown email kind ${row.kind}` };
    const kind: EmailKind = row.kind;
    const template = EMAIL_TEMPLATES[kind];

    // ---- recipient and preference checks, at send time
    let unsubscribeToken: string | null = null;
    if (template.audience === 'customer') {
      if (!row.customer_id) return { status: 'cancelled', reason: 'customer deleted' };
      const { rows } = await this.deps.pool.query('SELECT email, is_active, notification_prefs FROM customers WHERE id = $1', [row.customer_id]);
      const customer = rows[0];
      if (!customer) return { status: 'cancelled', reason: 'customer deleted' };
      if (!customer.email) return { status: 'cancelled', reason: 'customer has no email address' };
      if (kind === 'customer.verify_email') {
        if (customer.is_active) return { status: 'cancelled', reason: 'account already verified' };
      } else if (kind !== 'customer.message' && !customer.is_active) {
        // Shipment and password emails go to active (verified) customers only. Message emails also reach CRM leads.
        return { status: 'cancelled', reason: 'customer is not active' };
      }
      if (template.preference === 'shipment_updates') {
        if (!normaliseCustomerPrefs(customer.notification_prefs).shipment_updates) {
          return { status: 'cancelled', reason: 'customer turned off shipment update emails' };
        }
        unsubscribeToken = createUnsubscribeToken(
          { customerId: row.customer_id, prefKey: 'shipment_updates', issuedAt: new Date(row.created_at) },
          this.deps.config.linkSecret
        );
      }
    } else if (template.audience === 'admin') {
      if (!row.admin_id) return { status: 'cancelled', reason: 'admin deleted' };
      const { rows } = await this.deps.pool.query('SELECT is_active, deleted_at, notification_prefs FROM admins WHERE id = $1', [row.admin_id]);
      const admin = rows[0];
      if (!admin) return { status: 'cancelled', reason: 'admin deleted' };
      if (template.preference === 'shipment_created') {
        // Operational emails only for working accounts; account notices (roles, deactivation, passwords) always go out.
        if (admin.is_active === false || admin.deleted_at) return { status: 'cancelled', reason: 'admin is not active' };
        if (!normaliseAdminPrefs(admin.notification_prefs).shipment_created) {
          return { status: 'cancelled', reason: 'admin turned off new shipment emails' };
        }
      }
    }

    // ---- render (params were frozen at enqueue; with the same row this output is identical on every attempt)
    const ctx = templateContext({ bases: this.deps.config.bases, supportReplyTo: Boolean(this.deps.config.replyTo), unsubscribeToken, brand: this.deps.config.brand });
    const email = renderTemplate(kind, row.params as never, ctx);
    const headers: Record<string, string> = {};
    if (unsubscribeToken) {
      // RFC 8058 one-click unsubscribe (shipment update emails only; service emails have none).
      headers['List-Unsubscribe'] = `<${links(this.deps.config.bases).unsubscribe(unsubscribeToken)}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }

    try {
      const result = await this.deps.provider.send({
        to: row.to_address,
        from: this.deps.config.from,
        replyTo: this.deps.config.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers,
        idempotencyKey: row.idempotency_key,
      });
      return { status: 'sent', providerMessageId: result.providerMessageId };
    } catch (err) {
      const e = err instanceof EmailSendError ? err : new EmailSendError('retryable', (err as Error)?.message ?? String(err));
      if (e.kind === 'permanent') return { status: 'failed', error: e.message };
      if (e.kind === 'rate_limited') return { status: 'retry', delayMs: e.retryAfterMs ?? 60_000, error: e.message, countAttempt: false };
      if (row.attempts >= MAX_ATTEMPTS) return { status: 'failed', error: `gave up after ${row.attempts} attempts: ${e.message}` };
      return { status: 'retry', delayMs: RETRY_DELAYS_MS[row.attempts - 1], error: e.message, countAttempt: true };
    }
  }

  private async record(row: DeliveryRow, outcome: Outcome) {
    const pool = this.deps.pool;
    switch (outcome.status) {
      case 'sent':
        await pool.query(
          `UPDATE email_deliveries SET status = 'sent', sent_at = NOW(), locked_at = NULL, provider_message_id = $2, last_error = NULL,
                  params = params - ${SECRET_KEYS_SQL}
            WHERE id = $1 AND status = 'sending'`,
          [row.id, outcome.providerMessageId]
        );
        return;
      case 'cancelled':
      case 'failed':
        await pool.query(
          `UPDATE email_deliveries SET status = $2, locked_at = NULL, last_error = $3, params = params - ${SECRET_KEYS_SQL}
            WHERE id = $1 AND status = 'sending'`,
          [row.id, outcome.status, truncate(outcome.status === 'cancelled' ? outcome.reason : outcome.error)]
        );
        return;
      case 'retry':
        await pool.query(
          `UPDATE email_deliveries SET status = 'queued', locked_at = NULL, last_error = $3,
                  next_attempt_at = NOW() + make_interval(secs => $2::double precision / 1000),
                  attempts = attempts - $4
            WHERE id = $1 AND status = 'sending'`,
          [row.id, outcome.delayMs, truncate(outcome.error), outcome.countAttempt ? 0 : 1]
        );
        return;
    }
  }
}
