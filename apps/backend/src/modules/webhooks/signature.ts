// Webhook signature verification, Svix / Standard Webhooks scheme (what Resend uses). No dependency: HMAC-SHA256 from node:crypto.
//   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
//   key            = base64-decode(secret without its "whsec_" prefix)
//   svix-signature = space-separated "v1,<base64 HMAC>" entries; any one matching is enough (secret rotation sends several)
import crypto from 'crypto';

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** Decodes a "whsec_…" secret; throws when it is not one (checked at startup by the email config). */
export function webhookKey(secret: string): Buffer {
  if (!secret.startsWith('whsec_')) throw new Error('must start with "whsec_"');
  const encoded = secret.slice('whsec_'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('must be "whsec_" followed by base64');
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 16) throw new Error('decodes to fewer than 16 bytes');
  return key;
}

export function signWebhook(key: Buffer, id: string, timestamp: string, body: Buffer | string): string {
  return crypto.createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest('base64');
}

export type VerifyResult = { ok: true } | { ok: false; status: 400 | 401; reason: string };

export function verifyWebhook(options: {
  key: Buffer;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  body: Buffer;
  nowSeconds?: number;
}): VerifyResult {
  const { key, id, timestamp, signature, body } = options;
  if (!id || !timestamp || !signature) return { ok: false, status: 400, reason: 'missing svix-id, svix-timestamp or svix-signature header' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, status: 400, reason: 'invalid svix-timestamp' };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, status: 400, reason: 'timestamp outside the tolerance' };

  const expected = Buffer.from(signWebhook(key, id, timestamp, body), 'base64');
  for (const entry of signature.split(' ')) {
    const [version, value] = entry.split(',', 2);
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value, 'base64');
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, status: 401, reason: 'no matching signature' };
}
