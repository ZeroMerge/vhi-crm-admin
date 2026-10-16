// Signed one-click unsubscribe tokens: base64url(JSON {c, k, t}) + "." + base64url(HMAC-SHA256(secret, payload part)).
// c = customer id, k = preference key, t = issued-at (seconds; the delivery row's created_at, so retries render identically).
import crypto from 'crypto';
import type { CustomerPrefKey } from './preferences';

export const UNSUBSCRIBE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const UNSUBSCRIBABLE: CustomerPrefKey[] = ['shipment_updates'];

const b64url = (buf: Buffer) => buf.toString('base64url');
const sign = (payload: string, secret: string) => crypto.createHmac('sha256', secret).update(payload).digest();

export function createUnsubscribeToken(input: { customerId: string; prefKey: CustomerPrefKey; issuedAt: Date }, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ c: input.customerId, k: input.prefKey, t: Math.floor(input.issuedAt.getTime() / 1000) })));
  return `${payload}.${b64url(sign(payload, secret))}`;
}

/** Returns the customer and preference, or null for anything malformed, tampered, expired or not unsubscribable. */
export function verifyUnsubscribeToken(token: unknown, secret: string, now: number = Date.now()): { customerId: string; prefKey: CustomerPrefKey } | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;
  const expected = sign(payload, secret);
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let body: { c?: unknown; k?: unknown; t?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof body.c !== 'string' || typeof body.k !== 'string' || typeof body.t !== 'number') return null;
  if (!UNSUBSCRIBABLE.includes(body.k as CustomerPrefKey)) return null;
  const issuedMs = body.t * 1000;
  if (issuedMs > now + 5 * 60_000 || now - issuedMs > UNSUBSCRIBE_TTL_MS) return null;
  return { customerId: body.c, prefKey: body.k as CustomerPrefKey };
}
