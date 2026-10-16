import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { dbTest, resetDatabase, truncateAll } from './helpers/db';
import { startApp, request, TestApp } from './helpers/app';
import { adminToken, insertAdmin, insertCustomer, insertShipment } from './helpers/fixtures';
import pool from '../src/config/db';
import { clearAdminAccountCache } from '../src/middleware/permissions';
import shipmentsRoutes from '../src/modules/shipments/shipments.routes';
import { adminTrackingRoutes } from '../src/modules/tracking/tracking.routes';
import clientAuthRoutes from '../src/modules/client/client.auth.routes';

const MIGRATION = path.join(__dirname, '../src/db/migrations/024_scheduler_and_jobs.sql');

describe('Phase 4 migrations: status_changed_at and verified_at', dbTest, () => {
  let app: TestApp;
  before(async () => {
    await resetDatabase();
    app = await startApp([
      ['/api/admin/shipments', shipmentsRoutes],
      ['/api/admin/tracking', adminTrackingRoutes],
      ['/api/client/auth', clientAuthRoutes],
    ]);
  });
  beforeEach(async () => {
    await truncateAll();
    clearAdminAccountCache();
  });
  after(async () => {
    await app?.close();
    await pool.end();
  });

  const changedAt = async (id: string) => new Date((await pool.query('SELECT status_changed_at FROM shipments WHERE id = $1', [id])).rows[0].status_changed_at).getTime();

  test('backfill: latest audited transition into the current status, else updated_at, else created_at', async () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n');
    const backfill = sql.slice(sql.indexOf('UPDATE shipments s'), sql.indexOf(';', sql.indexOf('UPDATE shipments s')) + 1);
    assert.ok(backfill.startsWith('UPDATE shipments s') && backfill.includes("a.action = 'UPDATE_SHIPMENT_STATUS'"));

    const c = await insertCustomer();
    const audited = await insertShipment(c.id, { status: 'in_transit' });
    const viaTracking = await insertShipment(c.id, { status: 'clearance' });
    const cancelled = await insertShipment(c.id, { status: 'cancelled' });
    const noAudit = await insertShipment(c.id, { status: 'processing' });
    const t = (iso: string) => new Date(iso);
    const audit = (id: string, action: string, metadata: object, at: string) =>
      pool.query(
        `INSERT INTO audit_logs (actor_type, action, resource_type, resource_id, metadata, created_at) VALUES ('admin', $1, 'shipment', $2, $3, $4)`,
        [action, id, JSON.stringify(metadata), at]
      );
    await audit(audited.id, 'UPDATE_SHIPMENT_STATUS', { from: 'pending', to: 'processing' }, '2026-09-01T10:00:00Z');
    await audit(audited.id, 'UPDATE_SHIPMENT_STATUS', { from: 'processing', to: 'in_transit' }, '2026-09-03T10:00:00Z');
    await audit(audited.id, 'UPDATE_SHIPMENT_STATUS', { from: 'x', to: 'in_transit' }, '2026-09-02T10:00:00Z'); // older, same target
    await audit(viaTracking.id, 'ADD_TRACKING_UPDATE', { noteOnly: false, from: 'in_transit', to: 'clearance' }, '2026-09-05T08:00:00Z');
    await audit(viaTracking.id, 'ADD_TRACKING_UPDATE', { noteOnly: true, from: 'clearance', to: 'clearance' }, '2026-09-06T08:00:00Z'); // a note: ignored
    await audit(cancelled.id, 'CANCEL_SHIPMENT', { orderId: 'x' }, '2026-09-07T09:00:00Z');
    await pool.query(`UPDATE shipments SET updated_at = '2026-09-10T12:00:00Z' WHERE id = $1`, [noAudit.id]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE shipments ALTER COLUMN status_changed_at DROP NOT NULL');
      await client.query('UPDATE shipments SET status_changed_at = NULL');
      await client.query(backfill);
      const { rows } = await client.query('SELECT id, status_changed_at FROM shipments');
      const at = (id: string) => new Date(rows.find((r) => r.id === id).status_changed_at).toISOString();
      assert.equal(at(audited.id), t('2026-09-03T10:00:00Z').toISOString(), 'latest transition into in_transit');
      assert.equal(at(viaTracking.id), t('2026-09-05T08:00:00Z').toISOString(), 'tracking transition, not the later note');
      assert.equal(at(cancelled.id), t('2026-09-07T09:00:00Z').toISOString(), 'customer cancel');
      assert.equal(at(noAudit.id), t('2026-09-10T12:00:00Z').toISOString(), 'no audit row → updated_at');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('status_changed_at moves on transitions and corrections, not on note-only tracking updates', async () => {
    const admin = await insertAdmin({ assignedRoles: ['super_admin'] });
    const token = adminToken({ ...admin, activeRole: 'super_admin' });
    const c = await insertCustomer();
    const s = await insertShipment(c.id, { status: 'pending' });
    await pool.query(`UPDATE shipments SET status_changed_at = NOW() - interval '5 days' WHERE id = $1`, [s.id]);
    const old = await changedAt(s.id);

    assert.equal((await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'processing' } })).status, 200);
    const afterTransition = await changedAt(s.id);
    assert.ok(afterTransition > old + 4 * 86_400_000, 'transition stamps now');

    await pool.query(`UPDATE shipments SET status_changed_at = NOW() - interval '2 days' WHERE id = $1`, [s.id]);
    const beforeNote = await changedAt(s.id);
    assert.equal((await request(app, 'POST', `/api/admin/tracking/${s.id}/update`, { token, body: { message: 'Note only' } })).status, 200);
    assert.equal(await changedAt(s.id), beforeNote, 'a note-only update is not a transition');

    assert.equal((await request(app, 'POST', `/api/admin/tracking/${s.id}/update`, { token, body: { status: 'in_transit', message: 'Moving' } })).status, 200);
    const afterTracking = await changedAt(s.id);
    assert.ok(afterTracking > beforeNote, 'a status change through the tracking route stamps it');

    await pool.query(`UPDATE shipments SET status_changed_at = NOW() - interval '2 days' WHERE id = $1`, [s.id]);
    const beforeCorrection = await changedAt(s.id);
    const corr = await request(app, 'PUT', `/api/admin/shipments/${s.id}/status`, { token, body: { status: 'processing', reason: 'Wrong scan' } });
    assert.equal(corr.status, 200);
    assert.ok((await changedAt(s.id)) > beforeCorrection, 'corrections are transitions too');
  });

  test('verified_at: set at email verification (production) and at signup when verification is skipped', async () => {
    const body = { firstname: 'V', lastname: 'T', email: 'verify@test.local', password: 'Secret-Pass-1' };
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.equal((await request(app, 'POST', '/api/client/auth/register', { body })).status, 201);
    } finally {
      process.env.NODE_ENV = prev;
    }
    let row = (await pool.query(`SELECT is_active, verified_at FROM customers WHERE email = 'verify@test.local'`)).rows[0];
    assert.deepEqual([row.is_active, row.verified_at], [false, null]);
    const token = (await pool.query('SELECT token FROM email_verification_tokens')).rows[0].token;
    assert.equal((await request(app, 'GET', `/api/client/auth/verify-email?token=${token}`)).status, 200);
    row = (await pool.query(`SELECT is_active, verified_at FROM customers WHERE email = 'verify@test.local'`)).rows[0];
    assert.equal(row.is_active, true);
    assert.ok(row.verified_at, 'verified_at set at verification');

    assert.equal((await request(app, 'POST', '/api/client/auth/register', { body: { ...body, email: 'dev@test.local' } })).status, 201);
    const dev = (await pool.query(`SELECT is_active, verified_at FROM customers WHERE email = 'dev@test.local'`)).rows[0];
    assert.equal(dev.is_active, true);
    assert.ok(dev.verified_at, 'non-production signup counts as verified');
  });
});
