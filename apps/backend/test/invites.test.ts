import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import adminManagementRoutes from '../src/modules/admin/admin_management.routes';
import authRoutes, { inviteAcceptLimiter, inviteInspectLimiter } from '../src/modules/auth/auth.routes';
import clientAuthRoutes from '../src/modules/client/client.auth.routes';
import { EmailWorker } from '../src/modules/email/worker';
import type { EmailProvider, OutgoingEmail } from '../src/modules/email/provider';
import { INVITE_PENDING } from '../src/modules/admin/invites';
import { passwordProblem } from '../src/utils/passwordPolicy';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const BASES = { client: 'https://client.test', admin: 'https://admin.test', api: 'https://api.test' };
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

class FakeProvider implements EmailProvider {
  readonly name = 'fake';
  sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail) {
    this.sent.push(email);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
const drain = async () => {
  const provider = new FakeProvider();
  await new EmailWorker({ pool, provider, log: quiet, config: { from: 'VHI <n@test.local>', replyTo: null, linkSecret: 'x'.repeat(64), bases: BASES, concurrency: 2 } }).drain();
  return provider;
};

describe('password rule (D3)', () => {
  test('8–72 (bytes), not the email (case-insensitive)', () => {
    assert.equal(passwordProblem('Short-1'), 'Password must be at least 8 characters');
    assert.equal(passwordProblem('Long-enough'), null);
    assert.equal(passwordProblem('a'.repeat(72)), null);
    assert.match(String(passwordProblem('a'.repeat(73))), /at most 72/);
    assert.match(String(passwordProblem('é'.repeat(37))), /at most 72/, '37 characters but 74 bytes');
    assert.equal(passwordProblem('😀😀😀😀😀😀😀😀'), null, '8 characters (32 bytes)');
    assert.equal(passwordProblem(' Ada@Example.com ', 'ada@example.com'), 'Password must not be your email address');
    assert.equal(passwordProblem(undefined), 'Password is required');
    assert.equal(passwordProblem(12345678 as unknown), 'Password is required');
  });
});

describe('admin invite flow', dbTest, () => {
  let app: TestApp;
  let sa: Awaited<ReturnType<typeof insertAdmin>>;
  let saToken: string;

  before(async () => {
    await resetDatabase();
    app = await startApp([
      ['/api/admin/admins', adminManagementRoutes],
      ['/api/auth', authRoutes],
      ['/api/client/auth', clientAuthRoutes],
    ]);
  });
  beforeEach(async () => {
    await truncateAll();
    clearAdminAccountCache();
    inviteInspectLimiter.reset();
    inviteAcceptLimiter.reset();
    sa = await insertAdmin({ assignedRoles: ['super_admin'] });
    await pool.query(`UPDATE admins SET name = 'Tunde Bakare' WHERE id = $1`, [sa.id]);
    saToken = adminToken({ ...sa, activeRole: 'super_admin' });
  });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const invite = (email = 'funmi@test.local', roles = ['finance_officer']) =>
    request(app, 'POST', '/api/admin/admins/invite', { token: saToken, body: { name: 'Funmi', email, assignedRoles: roles } });
  const queuedToken = async (email = 'funmi@test.local') =>
    (await pool.query(`SELECT params->>'token' AS token FROM email_deliveries WHERE kind = 'admin.invite' AND to_address = $1 ORDER BY id DESC`, [email])).rows[0]?.token as string;
  const inspect = (token: unknown) => request(app, 'POST', '/api/auth/admin/invite/inspect', { body: { token } });
  const accept = (token: unknown, password = 'Brand-New-Pass-1', confirmPassword = password) =>
    request(app, 'POST', '/api/auth/admin/accept-invite', { body: { token, password, confirmPassword } });
  const login = (email: string, password: string) => request(app, 'POST', '/api/auth/admin/login', { body: { email, password } });

  test('invite: no password or link in the response; token only in the queued email, hashed at rest; audited; listed as pending', async () => {
    const res = await invite();
    assert.equal(res.status, 201);
    assert.equal(res.body.message, 'Invitation email sent to funmi@test.local');
    assert.equal(res.body.data.invitePending, true);
    const flat = JSON.stringify(res.body);
    assert.ok(!/tempPassword|inviteLink|token/i.test(flat), flat);

    const admin = (await pool.query(`SELECT id, password_hash FROM admins WHERE email = 'funmi@test.local'`)).rows[0];
    assert.equal(admin.password_hash, INVITE_PENDING);
    const token = await queuedToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const inv = (await pool.query('SELECT token_hash, expires_at, created_by, created_at FROM admin_invites WHERE admin_id = $1', [admin.id])).rows;
    assert.equal(inv.length, 1);
    assert.ok(Buffer.compare(inv[0].token_hash, sha256(token)) === 0, 'SHA-256 of the token is stored');
    assert.ok(!(await pool.query(`SELECT 1 FROM admin_invites WHERE encode(token_hash, 'escape') LIKE '%' || $1 || '%'`, [token])).rows.length);
    const hours = (new Date(inv[0].expires_at).getTime() - new Date(inv[0].created_at).getTime()) / 3_600_000;
    assert.equal(Math.round(hours), 72);
    assert.equal(inv[0].created_by, sa.id);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'INVITE_ADMIN' AND resource_id = $1`, [admin.id])).rows[0].n, 1);

    const list = await request(app, 'GET', '/api/admin/admins', { token: saToken });
    const byEmail = Object.fromEntries(list.body.data.map((a: { email: string; invitePending: boolean }) => [a.email, a.invitePending]));
    assert.deepEqual([byEmail['funmi@test.local'], byEmail[sa.email]], [true, false]);
  });

  test('the email: link to /admin/accept-invite with the token; the token is wiped from the row once sent', async () => {
    await invite();
    const token = await queuedToken();
    const provider = await drain();
    assert.equal(provider.sent.length, 1);
    const email = provider.sent[0];
    assert.equal(email.subject, "You're invited to VHI CRM");
    assert.ok(email.text.includes(`https://admin.test/admin/accept-invite?token=${token}`), email.text);
    assert.ok(email.text.includes('Tunde Bakare has invited you to VHI CRM as Finance Officer.'));
    assert.ok(email.text.includes('This link expires in 72 hours.'));
    const row = (await pool.query(`SELECT status, params FROM email_deliveries WHERE kind = 'admin.invite'`)).rows[0];
    assert.equal(row.status, 'sent');
    assert.equal(row.params.token, undefined);
  });

  test('the email is queued in the same transaction: a failure leaves no admin, no invitation and no email', async () => {
    await pool.query(`CREATE FUNCTION fail_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox down'; END $$`);
    await pool.query(`CREATE TRIGGER fail_email BEFORE INSERT ON email_deliveries FOR EACH ROW EXECUTE FUNCTION fail_email()`);
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal((await invite()).status, 500);
    } finally {
      console.error = original;
      await pool.query('DROP TRIGGER fail_email ON email_deliveries');
      await pool.query('DROP FUNCTION fail_email()');
    }
    const counts = (await pool.query(`SELECT (SELECT COUNT(*)::int FROM admins WHERE email = 'funmi@test.local') AS admins, (SELECT COUNT(*)::int FROM admin_invites) AS invites, (SELECT COUNT(*)::int FROM email_deliveries) AS emails`)).rows[0];
    assert.deepEqual(counts, { admins: 0, invites: 0, emails: 0 });
  });

  test('a pending admin cannot log in, whatever the password', async () => {
    await invite();
    for (const pw of [INVITE_PENDING, 'anything-at-all', '']) {
      const res = await login('funmi@test.local', pw);
      assert.ok([400, 401].includes(res.status), String(res.status));
      assert.ok(!res.body.data?.token);
    }
  });

  test('inspect (POST, no GET): valid → email and name; malformed/unknown → 400; expired → 410; headers', async () => {
    await invite();
    const token = await queuedToken();
    const ok = await inspect(token);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data, { email: 'funmi@test.local', name: 'Funmi' });
    assert.equal((await inspect('not-a-token')).status, 400);
    assert.equal((await inspect(crypto.randomBytes(32).toString('base64url'))).status, 400);
    assert.equal((await inspect(undefined)).status, 400);
    assert.equal((await inspect(['x'])).status, 400);

    const res = await fetch(`${app.url}/api/auth/admin/invite/inspect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${app.url}/api/auth/admin/invite?token=${token}`)).status, 404, 'no GET endpoint carries the token');

    await pool.query(`UPDATE admin_invites SET expires_at = NOW() - interval '1 second'`);
    const expired = await inspect(token);
    assert.deepEqual([expired.status, expired.body.code], [410, 'expired']);
    assert.match(expired.body.message, /expired\. Ask a super admin/);
    assert.equal((await accept(token)).status, 410);
  });

  test('accept: password rules first (nothing changes), then sets the password once; login works afterwards', async () => {
    await invite();
    const token = await queuedToken();
    const bad: Array<[string, string, RegExp]> = [
      ['short', 'short', /at least 8/],
      ['é'.repeat(37), 'é'.repeat(37), /at most 72/],
      ['FUNMI@test.local', 'FUNMI@test.local', /not be your email/],
      ['Brand-New-Pass-1', 'Brand-New-Pass-2', /do not match/],
    ];
    for (const [password, confirm, message] of bad) {
      const res = await accept(token, password, confirm);
      assert.deepEqual([res.status, res.body.code], [400, 'password']);
      assert.match(res.body.message, message);
    }
    assert.equal((await pool.query(`SELECT password_hash FROM admins WHERE email = 'funmi@test.local'`)).rows[0].password_hash, INVITE_PENDING);

    const ok = await accept(token);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data, { email: 'funmi@test.local' });
    assert.equal(ok.body.data.token, undefined, 'no session is created');
    const used = (await pool.query('SELECT used_at FROM admin_invites')).rows[0];
    assert.ok(used.used_at);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'ACCEPT_ADMIN_INVITE'`)).rows[0].n, 1);

    const again = await accept(token, 'Another-Pass-9');
    assert.deepEqual([again.status, again.body.code], [400, 'invalid'], 'single use');
    assert.equal((await inspect(token)).status, 400);

    const signedIn = await login('funmi@test.local', 'Brand-New-Pass-1');
    assert.equal(signedIn.status, 200);
    assert.ok(signedIn.body.data.token);
    assert.equal((await login('funmi@test.local', 'Another-Pass-9')).status, 401);

    const list = await request(app, 'GET', '/api/admin/admins', { token: saToken });
    assert.equal(list.body.data.find((a: { email: string }) => a.email === 'funmi@test.local').invitePending, false);
  });

  test('two accepts at the same moment: exactly one wins', async () => {
    await invite();
    const token = await queuedToken();
    const results = await Promise.all([accept(token, 'First-Pass-111'), accept(token, 'Second-Pass-222')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  test('resend: the old link stops working, the still-queued email carries the new token; 409 once accepted; 404/409 edge cases', async () => {
    await invite();
    const first = await queuedToken();
    const admin = (await pool.query(`SELECT id FROM admins WHERE email = 'funmi@test.local'`)).rows[0];
    const res = await request(app, 'POST', `/api/admin/admins/${admin.id}/resend-invite`, { token: saToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'A new invitation was sent to funmi@test.local; the previous link no longer works.');
    const second = await queuedToken();
    assert.notEqual(second, first);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM email_deliveries WHERE kind = 'admin.invite'`)).rows[0].n, 1, 'grouped into the queued email');
    assert.equal((await inspect(first)).status, 400, 'revoked');
    assert.equal((await inspect(second)).status, 200);
    assert.deepEqual((await pool.query('SELECT (revoked_at IS NOT NULL) AS revoked FROM admin_invites ORDER BY id')).rows.map((r) => r.revoked), [true, false]);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'RESEND_ADMIN_INVITE'`)).rows[0].n, 1);

    // After the first email was sent, a resend queues a new one.
    await drain();
    await request(app, 'POST', `/api/admin/admins/${admin.id}/resend-invite`, { token: saToken });
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM email_deliveries WHERE kind = 'admin.invite'`)).rows[0].n, 2);

    assert.equal((await accept(await queuedToken())).status, 200);
    assert.equal((await request(app, 'POST', `/api/admin/admins/${admin.id}/resend-invite`, { token: saToken })).status, 409);
    assert.equal((await request(app, 'POST', `/api/admin/admins/${crypto.randomUUID()}/resend-invite`, { token: saToken })).status, 404);
    assert.equal((await request(app, 'POST', `/api/admin/admins/${sa.id}/resend-invite`, { token: saToken })).status, 409, 'an existing admin with a password');

    await invite('inactive@test.local');
    const inactive = (await pool.query(`UPDATE admins SET is_active = false WHERE email = 'inactive@test.local' RETURNING id`)).rows[0];
    assert.equal((await request(app, 'POST', `/api/admin/admins/${inactive.id}/resend-invite`, { token: saToken })).status, 409);
  });

  test('a deactivated or deleted invitee: the link stops working and a queued invite email is cancelled', async () => {
    await invite();
    const token = await queuedToken();
    await pool.query(`UPDATE admins SET deleted_at = NOW(), is_active = false WHERE email = 'funmi@test.local'`);
    assert.equal((await inspect(token)).status, 400);
    assert.equal((await accept(token)).status, 400);
    const provider = await drain();
    assert.equal(provider.sent.length, 0);
    assert.deepEqual((await pool.query(`SELECT status, last_error FROM email_deliveries`)).rows[0], { status: 'cancelled', last_error: 'admin is not active' });
  });

  test('only super_admin invites and resends', async () => {
    const m = await insertAdmin({ assignedRoles: ['manager'] });
    const token = adminToken({ ...m, activeRole: 'manager' });
    assert.equal((await request(app, 'POST', '/api/admin/admins/invite', { token, body: { name: 'X', email: 'x@test.local', assignedRoles: ['manager'] } })).status, 403);
    assert.equal((await request(app, 'POST', `/api/admin/admins/${m.id}/resend-invite`, { token })).status, 403);
  });

  test('rate limit: 10 per minute per IP on inspect and on accept (429 with Retry-After)', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await inspect('x')).status, 400);
    const limited = await fetch(`${app.url}/api/auth/admin/invite/inspect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"x"}' });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    // Accept has its own budget.
    for (let i = 0; i < 10; i++) assert.equal((await accept('x')).status, 400);
    assert.equal((await accept('x')).status, 429);
    // Even a valid token is refused while limited (no work done).
    await invite();
    assert.equal((await accept(await queuedToken())).status, 429);
    assert.equal((await pool.query(`SELECT password_hash FROM admins WHERE email = 'funmi@test.local'`)).rows[0].password_hash, INVITE_PENDING);
  });

  test('D3 on admin change-password and customer registration', async () => {
    const hash = await import('bcryptjs').then((b) => b.default.hash('Old-Pass-1', 4));
    await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, sa.id]);
    const change = (newPassword: string) => request(app, 'PUT', '/api/auth/admin/change-password', { token: saToken, body: { currentPassword: 'Old-Pass-1', newPassword } });
    assert.equal((await change('short')).status, 400);
    assert.match((await change(sa.email.toUpperCase())).body.message, /not be your email/);
    assert.match((await change('x'.repeat(73))).body.message, /at most 72/);
    assert.equal((await request(app, 'PUT', '/api/auth/admin/change-password', { token: saToken, body: { newPassword: 'New-Pass-22' } })).status, 400, 'missing current password → 400, not 500');
    assert.equal((await change('New-Pass-22')).status, 200);

    const register = (password: string, email = 'reg@test.local') =>
      request(app, 'POST', '/api/client/auth/register', { body: { firstname: 'R', lastname: 'T', email, password } });
    assert.match((await register('short')).body.message, /at least 8/);
    assert.match((await register('Reg@Test.local')).body.message, /not be your email/);
    assert.match((await register('é'.repeat(37))).body.message, /at most 72/);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM customers')).rows[0].n, 0);
    assert.equal((await register('Good-Pass-1')).status, 201);
  });
});
