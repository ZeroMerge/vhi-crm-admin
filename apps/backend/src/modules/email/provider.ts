export interface OutgoingEmail {
  to: string;
  from: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Same value on every retry of one delivery, so the provider can drop duplicates. */
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

export type EmailErrorKind = 'retryable' | 'permanent' | 'rate_limited';

export class EmailSendError extends Error {
  constructor(
    readonly kind: EmailErrorKind,
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}
