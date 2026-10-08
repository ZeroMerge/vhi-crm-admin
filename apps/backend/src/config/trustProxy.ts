// TRUST_PROXY_HOPS: how many reverse proxies sit in front of this server (Render: 1). With N > 0, Express takes req.ip from the
// X-Forwarded-For entry N hops from the right, so per-IP rate limits see the real client. 0 (default) = off: req.ip is the
// socket address (behind a proxy, the proxy's). Too high a value lets clients spoof their IP by sending their own header.
import type { Express } from 'express';

export const MAX_TRUST_PROXY_HOPS = 5;

/** Throws with a readable message for anything but an integer 0..5. */
export function trustProxyHopsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > MAX_TRUST_PROXY_HOPS) {
    throw new Error(`TRUST_PROXY_HOPS must be an integer between 0 and ${MAX_TRUST_PROXY_HOPS} (got "${raw}")`);
  }
  return n;
}

export function applyTrustProxy(app: Express, hops: number): void {
  if (hops > 0) app.set('trust proxy', hops);
}
