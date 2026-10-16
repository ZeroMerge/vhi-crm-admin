import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { dbTest, resetDatabase } from './helpers/db';
import pool from '../src/config/db';
import { applyTrustProxy, trustProxyHopsFromEnv } from '../src/config/trustProxy';
import { rateLimit } from '../src/middleware/rateLimit';
import authRoutes, { inviteInspectLimiter } from '../src/modules/auth/auth.routes';

async function serve(hops: number, mount: (app: express.Express) => void): Promise<{ url: string; server: Server }> {
  const app = express();
  applyTrustProxy(app, hops);
  app.use(express.json());
  mount(app);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
const close = (s: Server) => new Promise((r) => s.close(r));
const from = (url: string, xff: string, init: RequestInit = {}) =>
  fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Forwarded-For': xff } });

describe('TRUST_PROXY_HOPS', () => {
  test('parsing: default 0; integers 0..5; anything else is a startup error', () => {
    assert.equal(trustProxyHopsFromEnv({}), 0);
    assert.equal(trustProxyHopsFromEnv({ TRUST_PROXY_HOPS: '' }), 0);
    assert.equal(trustProxyHopsFromEnv({ TRUST_PROXY_HOPS: '1' }), 1);
    assert.equal(trustProxyHopsFromEnv({ TRUST_PROXY_HOPS: ' 2 ' }), 2);
    for (const bad of ['-1', '1.5', 'true', '6', '1e1']) {
      assert.throws(() => trustProxyHopsFromEnv({ TRUST_PROXY_HOPS: bad }), /TRUST_PROXY_HOPS must be an integer between 0 and 5/, bad);
    }
  });

  const limited = (app: express.Express) => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 });
    app.get('/ip', limiter, (req, res) => res.json({ ip: req.ip }));
  };

  test('hops=1: two client IPs in X-Forwarded-For get separate rate-limit buckets; req.ip is the client', async () => {
    const { url, server } = await serve(1, limited);
    try {
      for (let i = 0; i < 2; i++) assert.equal((await from(`${url}/ip`, '203.0.113.7')).status, 200);
      assert.equal((await from(`${url}/ip`, '203.0.113.7')).status, 429);
      const other = await from(`${url}/ip`, '198.51.100.9');
      assert.equal(other.status, 200, 'a different client has its own budget');
      assert.equal(((await other.json()) as { ip: string }).ip, '198.51.100.9');
      // A client cannot pick its own bucket: only the entry added by the one trusted proxy (the right-most) counts.
      const spoof = await from(`${url}/ip`, '10.9.9.9, 198.51.100.9');
      assert.equal(spoof.status, 200);
      assert.equal(((await spoof.json()) as { ip: string }).ip, '198.51.100.9');
      assert.equal((await from(`${url}/ip`, '10.9.9.9, 198.51.100.9')).status, 429);
    } finally {
      await close(server);
    }
  });

  test('hops=0 (default): the header is ignored, so both "clients" share one bucket', async () => {
    const { url, server } = await serve(0, limited);
    try {
      assert.equal((await from(`${url}/ip`, '203.0.113.7')).status, 200);
      const second = await from(`${url}/ip`, '198.51.100.9');
      assert.equal(second.status, 200);
      assert.match(((await second.json()) as { ip: string }).ip, /127\.0\.0\.1/);
      assert.equal((await from(`${url}/ip`, '198.51.100.10')).status, 429);
    } finally {
      await close(server);
    }
  });
});

describe('TRUST_PROXY_HOPS with the real invite inspect route', dbTest, () => {
  before(async () => {
    await resetDatabase();
  });
  after(async () => {
    await pool.end();
  });

  const inspect = (url: string, xff: string) =>
    from(`${url}/api/auth/admin/invite/inspect`, xff, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"x"}' });

  for (const [hops, separate] of [[1, true], [0, false]] as const) {
    test(`hops=${hops}: ${separate ? 'separate' : 'shared'} 10/min budgets for two networks`, async () => {
      inviteInspectLimiter.reset();
      const { url, server } = await serve(hops, (app) => app.use('/api/auth', authRoutes));
      try {
        for (let i = 0; i < 10; i++) assert.equal((await inspect(url, '203.0.113.7')).status, 400);
        assert.equal((await inspect(url, '203.0.113.7')).status, 429);
        assert.equal((await inspect(url, '198.51.100.9')).status, separate ? 400 : 429);
      } finally {
        await close(server);
        inviteInspectLimiter.reset();
      }
    });
  }
});
