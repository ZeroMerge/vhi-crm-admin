// `npm run email:send-test -- --to <address> --template <key>`
// Sends ONE email-preview sample through the configured provider (EMAIL_PROVIDER / RESEND_API_KEY from the environment or
// apps/backend/.env), so real rendering and deliverability can be checked in real inboxes. No database access, nothing queued.
// <key> is a template kind (e.g. customer.message → its first sample) or a sample id from templates/samples.ts.
// Refuses to run when NODE_ENV=production. Prints the provider and its message id.
import crypto from 'crypto';
import dotenv from 'dotenv';
import { emailConfigFromEnv, EmailConfigError } from './config';
import { ConsoleProvider } from './consoleProvider';
import { ResendProvider } from './resendProvider';
import { EmailSendError } from './provider';
import { EMAIL_TEMPLATES, renderTemplate, templateContext } from './templates';
import { SAMPLES } from './templates/samples';
import { links } from './templates/urls';
import { createUnsubscribeToken } from './unsubscribeToken';

const USAGE = 'Usage: npm run email:send-test -- --to <address> --template <template kind or sample id>';
// Placeholder customer for the unsubscribe link of preference emails (the link opens the "invalid link" page).
const TEST_CUSTOMER_ID = '00000000-0000-4000-8000-000000000000';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  dotenv.config();
  if (process.env.NODE_ENV === 'production') fail('email:send-test refuses to run with NODE_ENV=production.');

  const to = arg('to');
  const key = arg('template');
  const usable = SAMPLES.filter((s) => !s.id.startsWith('x'));
  if (!to) fail(`Missing --to.\n${USAGE}`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) fail(`--to must be an email address.\n${USAGE}`);
  if (!key) fail(`Missing --template.\n${USAGE}\nTemplates: ${Object.keys(EMAIL_TEMPLATES).join(', ')}\nSamples: ${usable.map((s) => s.id).join(', ')}`);
  const sample = usable.find((s) => s.id === key) ?? usable.find((s) => s.kind === key);
  if (!sample) fail(`Unknown template "${key}".\nTemplates: ${Object.keys(EMAIL_TEMPLATES).join(', ')}\nSamples: ${usable.map((s) => s.id).join(', ')}`);

  let config;
  try {
    config = emailConfigFromEnv(process.env);
  } catch (err) {
    fail(err instanceof EmailConfigError ? err.message : String(err));
  }
  for (const w of config.warnings) console.warn(`[email] WARNING: ${w}`);

  const preference = EMAIL_TEMPLATES[sample.kind].preference === 'shipment_updates';
  const unsubscribeToken = preference
    ? createUnsubscribeToken({ customerId: TEST_CUSTOMER_ID, prefKey: 'shipment_updates', issuedAt: new Date() }, config.linkSecret)
    : null;
  const ctx = templateContext({ bases: config.bases, supportReplyTo: Boolean(config.replyTo), unsubscribeToken, brand: config.brand, timezone: config.timezone });
  const email = renderTemplate(sample.kind, sample.params as never, ctx);
  const headers: Record<string, string> = unsubscribeToken
    ? { 'List-Unsubscribe': `<${links(config.bases).unsubscribe(unsubscribeToken)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : {};

  const provider = config.provider === 'resend' ? new ResendProvider(config.resendApiKey!) : new ConsoleProvider();
  if (provider.name === 'console') console.warn('[email] provider is console: nothing leaves this machine (set EMAIL_PROVIDER=resend and RESEND_API_KEY).');
  try {
    const result = await provider.send({
      to,
      from: config.from,
      replyTo: config.replyTo,
      subject: `[Test] ${email.subject}`,
      html: email.html,
      text: email.text,
      headers,
      idempotencyKey: crypto.randomUUID(),
    });
    console.log(`provider: ${provider.name}`);
    console.log(`template: ${sample.kind} (sample ${sample.id})`);
    console.log(`message id: ${result.providerMessageId}`);
  } catch (err) {
    const e = err as EmailSendError;
    fail(`send failed${e.kind ? ` (${e.kind})` : ''}: ${e.message}`);
  }
}

main().catch((err) => fail(String(err)));
