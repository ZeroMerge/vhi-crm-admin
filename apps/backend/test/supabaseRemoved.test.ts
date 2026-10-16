import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import { dbTest } from './helpers/db';

// Phase 5: Supabase is gone from the application. Regression guards for that.

const SRC = path.join(__dirname, '../src');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('Supabase removed from the backend', () => {
  test('no "supabase" anywhere in src TypeScript (migrations keep their history comments)', () => {
    const hits = walk(SRC)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /supabase/i.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));
    assert.deepEqual(hits, []);
  });

  test('the realtime token module is gone and .env.example no longer lists SUPABASE_* variables', () => {
    assert.ok(!fs.existsSync(path.join(SRC, 'modules/realtime')));
    const example = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
    assert.ok(!/SUPABASE_/i.test(example));
    assert.ok(!/supabase/i.test(example), 'nor any comment about it');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /supabase/i.test(d)));
  });
});

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

describe('the server starts without Supabase variables', dbTest, () => {
  test('boots with no SUPABASE_* env; /api/realtime/admin-token and /client-token are 404', async () => {
    const port = await freePort();
    // From test/ (no .env there, so dotenv loads nothing); only the variables below exist, and none is a SUPABASE_* one.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      ADMIN_JWT_SECRET: 'test-admin-secret',
      CLIENT_JWT_SECRET: 'test-client-secret',
      EMAIL_PROVIDER: 'console',
      SCHEDULER_ENABLED: 'false',
    };
    assert.ok(!Object.keys(env).some((k) => k.startsWith('SUPABASE')));
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(SRC, 'index.ts')], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    try {
      const deadline = Date.now() + 30_000;
      while (!out.includes('VHI CRM Server running') && Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`server exited early:\n${out.slice(-1500)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(out.includes('VHI CRM Server running'), out.slice(-1500));
      const base = `http://127.0.0.1:${port}`;
      assert.equal((await fetch(`${base}/api/health`)).status, 200);
      for (const p of ['/api/realtime/admin-token', '/api/realtime/client-token']) {
        const res = await fetch(`${base}${p}`, { headers: { Authorization: 'Bearer anything' } });
        assert.equal(res.status, 404, p);
      }
      assert.ok(!/supabase/i.test(out), 'the startup log never mentions it');
    } finally {
      child.kill();
      await new Promise((r) => child.once('exit', r));
    }
  });
});
