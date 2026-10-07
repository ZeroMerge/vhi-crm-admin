// Email module entry: configuration (validated at startup, never at import), provider choice and the worker lifecycle.
import pool from '../../config/db';
import { emailConfigFromEnv, EmailConfig } from './config';
import { ConsoleProvider } from './consoleProvider';
import { ResendProvider } from './resendProvider';
import type { EmailProvider } from './provider';
import { EmailWorker } from './worker';
import { EMAIL_CHANNEL } from './outbox';

let config: EmailConfig | null = null;
let worker: EmailWorker | null = null;

/**
 * Validates email configuration. Called by src/index.ts before the server listens: an invalid production config
 * (e.g. resend without RESEND_API_KEY, missing EMAIL_LINK_SECRET or link bases) throws EmailConfigError there.
 */
export function initEmail(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  config = emailConfigFromEnv(env);
  return config;
}

/** Current config; initialised from the environment on first use (tests, scripts) if startup did not do it. */
export function emailConfig(): EmailConfig {
  return config ?? initEmail();
}

export function createProvider(cfg: EmailConfig): EmailProvider {
  return cfg.provider === 'resend' ? new ResendProvider(cfg.resendApiKey!) : new ConsoleProvider();
}

/** Starts the in-process worker. `listenTo` comes from the realtime bus so the wake-ups share its LISTEN connection. */
export function startEmailWorker(listenTo?: (channel: string, handler: () => void) => () => void): EmailWorker {
  const cfg = emailConfig();
  worker = new EmailWorker({
    pool,
    provider: createProvider(cfg),
    config: cfg,
    onWake: listenTo ? (wake) => listenTo(EMAIL_CHANNEL, wake) : undefined,
  });
  worker.start();
  console.log(`[email] worker started (provider: ${cfg.provider}, concurrency: ${cfg.concurrency})`);
  return worker;
}

export async function stopEmailWorker(): Promise<void> {
  const w = worker;
  worker = null;
  await w?.stop();
}

export { enqueueEmail, EMAIL_CHANNEL } from './outbox';
export { EmailConfigError } from './config';
