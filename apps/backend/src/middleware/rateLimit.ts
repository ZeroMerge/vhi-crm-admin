// Small in-memory fixed-window rate limiter for public endpoints (Phase 4: invite inspect / accept). Per process: with several
// instances the effective limit multiplies (as with the SSE limits, RISKS R-58).
//
// The key is req.ip, so it depends on TRUST_PROXY_HOPS (src/config/trustProxy.ts): set to the number of proxies in front of the
// server (Render: 1) it is the client's address; at 0 (default) behind a proxy it is the proxy's, and the limit is shared by all
// callers: stricter, never looser.
import type { Request, RequestHandler } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  message?: string;
}

export interface RateLimiter extends RequestHandler {
  reset(): void;
}

export function rateLimit(options: RateLimitOptions): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const keyOf = options.key ?? ((req: Request) => req.ip ?? 'unknown');

  const handler = ((req, res, next) => {
    const now = Date.now();
    // Drop expired windows now and then so the map cannot grow without bound.
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    const key = keyOf(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, message: options.message ?? 'Too many requests. Try again in a minute.' });
    }
    next();
  }) as RateLimiter;
  handler.reset = () => hits.clear();
  return handler;
}
