// The optional reason a customer gives when cancelling a pending shipment (DELETE /api/client/shipments/:orderId).
// Plain text only: it is stored as typed (audit metadata) and every screen renders it as text, never as HTML.

export const MAX_CANCEL_REASON_LENGTH = 500;

export type CancelReasonResult = { ok: true; reason: string | null } | { ok: false; message: string };

/** Accepts a missing body or reason (-> null). Rejects non-strings and anything over 500 characters (by code point). */
export function parseCancelReason(body: unknown): CancelReasonResult {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).reason : undefined;
  if (raw === undefined || raw === null) return { ok: true, reason: null };
  if (typeof raw !== 'string') return { ok: false, message: 'reason must be text' };

  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ') // control characters (tab becomes a space); newlines are kept
    .trim();
  if ([...cleaned].length > MAX_CANCEL_REASON_LENGTH) {
    return { ok: false, message: `reason must be ${MAX_CANCEL_REASON_LENGTH} characters or fewer` };
  }
  return { ok: true, reason: cleaned === '' ? null : cleaned };
}
