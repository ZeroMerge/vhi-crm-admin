import { Resend } from 'resend';
import { EmailProvider, EmailSendError, OutgoingEmail } from './provider';

interface ResendFailure {
  name: string;
  message: string;
  statusCode: number | null;
}

// Resend's Idempotency-Key is honoured for 24 hours (resend.com/docs/dashboard/emails/idempotency-keys);
// the worker's whole retry schedule fits inside that window.
export function classifyResendError(error: ResendFailure, headers: Record<string, string> | null): EmailSendError {
  const retryAfterSeconds = Number(headers?.['retry-after'] ?? headers?.['Retry-After']);
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined;
  const message = `${error.name}${error.statusCode ? ` (${error.statusCode})` : ''}: ${error.message}`;
  switch (error.name) {
    case 'rate_limit_exceeded':
      return new EmailSendError('rate_limited', message, retryAfterMs ?? 60_000);
    case 'daily_quota_exceeded':
      return new EmailSendError('rate_limited', message, retryAfterMs ?? 60 * 60_000);
    case 'monthly_quota_exceeded':
      return new EmailSendError('rate_limited', message, retryAfterMs ?? 6 * 60 * 60_000);
    case 'invalid_idempotent_request':
      // Same key, different payload: an earlier attempt of this delivery most likely went out.
      return new EmailSendError('permanent', `idempotency conflict, probably sent already: ${message}`);
    case 'concurrent_idempotent_requests':
    case 'application_error':
    case 'internal_server_error':
      return new EmailSendError('retryable', message);
    case 'invalid_api_key':
    case 'restricted_api_key':
    case 'missing_api_key':
      // A configuration mistake: keep the email and retry (it ends as failed after the schedule) instead of dropping it.
      return new EmailSendError('retryable', message);
  }
  if (error.statusCode === 429) return new EmailSendError('rate_limited', message, retryAfterMs ?? 60_000);
  if (error.statusCode === null || error.statusCode >= 500) return new EmailSendError('retryable', message);
  return new EmailSendError('permanent', message);
}

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  private client: Resend | null = null;

  constructor(private readonly apiKey: string) {}

  async send(email: OutgoingEmail) {
    // Constructed on first use (never at import): `new Resend()` throws without a key (RISKS R-01).
    this.client ??= new Resend(this.apiKey);
    let result;
    try {
      result = await this.client.emails.send(
        {
          from: email.from,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.replyTo ? { replyTo: email.replyTo } : {}),
          ...(email.headers && Object.keys(email.headers).length ? { headers: email.headers } : {}),
        },
        { idempotencyKey: email.idempotencyKey }
      );
    } catch (err) {
      throw new EmailSendError('retryable', `resend request failed: ${(err as Error).message}`);
    }
    if (result.error) {
      if (result.error.name === 'invalid_api_key' || result.error.name === 'restricted_api_key' || result.error.name === 'missing_api_key') {
        console.error(`[email] Resend rejected the API key (${result.error.name}); check RESEND_API_KEY`);
      }
      throw classifyResendError(result.error as ResendFailure, result.headers);
    }
    return { providerMessageId: result.data!.id };
  }
}
