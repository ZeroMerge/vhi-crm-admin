// Email configuration, read once at startup (startEmail in ./index.ts). Never read or validated at import time.
import crypto from 'crypto';
import { LinkBases, normaliseBase } from './templates/urls';
import { Brand, brandFromEnv } from './templates/brand';
import { DEFAULT_TIMEZONE, assertTimezone } from '../../utils/appTime';
import { webhookKey } from '../webhooks/signature';

export type EmailProviderName = 'resend' | 'console';

export interface EmailConfig {
  provider: EmailProviderName;
  resendApiKey: string | null;
  from: string;
  /** Reply-To for every email (SUPPORT_EMAIL). */
  replyTo: string | null;
  /** Where customer messages are emailed (SUPPORT_EMAIL, else the legacy SMTP_USER, as before). */
  supportInbox: string | null;
  linkSecret: string;
  bases: LinkBases;
  messageBatchMs: number;
  concurrency: number;
  /** EMAIL_BRAND_COLOR / EMAIL_LOGO_URL / EMAIL_COMPANY_ADDRESS (invalid values warn and fall back). */
  brand: Brand;
  /** APP_TIMEZONE (default Africa/Lagos): times shown in emails; the scheduler uses the same setting. */
  timezone: string;
  /** RESEND_WEBHOOK_SECRET ("whsec_…"): verifies bounce/complaint webhooks. Unset → the webhook route answers 503. */
  resendWebhookSecret: string | null;
  warnings: string[];
}

/** The sender used before EMAIL_FROM existed; kept as the fallback so production is unchanged until EMAIL_FROM is set. */
export const LEGACY_FROM = 'support@niesvlibrary.cloud';
export const MIN_LINK_SECRET_LENGTH = 32;

export class EmailConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Email configuration is invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EmailConfigError';
  }
}

const blank = (v: string | undefined) => v === undefined || v.trim() === '';

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const raw = env[name];
  if (blank(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return n;
}

/** Throws EmailConfigError listing every problem at once. */
export function emailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const production = env.NODE_ENV === 'production';
  const problems: string[] = [];
  const warnings: string[] = [];

  const requested = env.EMAIL_PROVIDER?.trim().toLowerCase();
  let provider: EmailProviderName = production ? 'resend' : 'console';
  if (requested) {
    if (requested === 'resend' || requested === 'console') provider = requested;
    else problems.push('EMAIL_PROVIDER must be "resend" or "console"');
  }
  if (production && provider === 'console') warnings.push('EMAIL_PROVIDER=console in production: emails are only logged, not sent.');

  const resendApiKey = blank(env.RESEND_API_KEY) ? null : env.RESEND_API_KEY!.trim();
  if (provider === 'resend' && !resendApiKey) problems.push('RESEND_API_KEY is required when EMAIL_PROVIDER is resend (the default in production)');

  let from = env.EMAIL_FROM?.trim() || '';
  if (!from) {
    from = LEGACY_FROM;
    if (production) warnings.push(`EMAIL_FROM is not set; sending from ${LEGACY_FROM}. Set EMAIL_FROM to an address on a verified VHI domain.`);
  } else if (!/@[^@\s]+\.[^@\s]+>?$/.test(from)) {
    problems.push('EMAIL_FROM must be an email address, optionally with a display name ("VHI <support@example.com>")');
  }

  const replyTo = env.SUPPORT_EMAIL?.trim() || null;
  const supportInbox = replyTo || env.SMTP_USER?.trim() || null;

  let linkSecret = env.EMAIL_LINK_SECRET?.trim() || '';
  if (!linkSecret) {
    if (production) problems.push('EMAIL_LINK_SECRET is required in production (signs unsubscribe links)');
    else {
      linkSecret = crypto.randomBytes(32).toString('hex');
      warnings.push('EMAIL_LINK_SECRET is not set; using a random secret for this process (unsubscribe links stop working after a restart).');
    }
  } else if (linkSecret.length < MIN_LINK_SECRET_LENGTH) {
    problems.push(`EMAIL_LINK_SECRET must be at least ${MIN_LINK_SECRET_LENGTH} characters`);
  }

  const port = env.PORT || '5000';
  const base = (name: 'CLIENT_FRONTEND_URL' | 'ADMIN_FRONTEND_URL' | 'API_PUBLIC_URL', devDefault: string) => {
    const raw = env[name]?.trim();
    if (!raw) {
      if (production) {
        problems.push(`${name} is required in production (email links are built from it)`);
        return devDefault;
      }
      return devDefault;
    }
    try {
      return normaliseBase(name, raw);
    } catch (err) {
      problems.push((err as Error).message);
      return devDefault;
    }
  };
  const bases: LinkBases = {
    client: base('CLIENT_FRONTEND_URL', 'http://localhost:5173'),
    admin: base('ADMIN_FRONTEND_URL', 'http://localhost:3000'),
    api: base('API_PUBLIC_URL', `http://localhost:${port}`),
  };

  const messageBatchMs = intEnv(env, 'EMAIL_MESSAGE_BATCH_MS', 120_000, 0, 3_600_000, problems);
  const concurrency = intEnv(env, 'EMAIL_WORKER_CONCURRENCY', 2, 1, 10, problems);

  const brand = brandFromEnv(env, production, warnings);

  let timezone = env.APP_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
  try {
    assertTimezone(timezone);
  } catch {
    problems.push(`APP_TIMEZONE "${timezone}" is not a valid IANA time zone (e.g. Africa/Lagos)`);
    timezone = DEFAULT_TIMEZONE;
  }

  const resendWebhookSecret = blank(env.RESEND_WEBHOOK_SECRET) ? null : env.RESEND_WEBHOOK_SECRET!.trim();
  if (resendWebhookSecret) {
    try {
      webhookKey(resendWebhookSecret);
    } catch (err) {
      problems.push(`RESEND_WEBHOOK_SECRET ${(err as Error).message} (copy the signing secret from Resend → Webhooks)`);
    }
  } else if (production && provider === 'resend') {
    problems.push('RESEND_WEBHOOK_SECRET is required in production with the resend provider (bounce and complaint handling)');
  }

  if (problems.length) throw new EmailConfigError(problems);
  return { provider, resendApiKey, from, replyTo, supportInbox, linkSecret, bases, messageBatchMs, concurrency, brand, timezone, resendWebhookSecret, warnings };
}
