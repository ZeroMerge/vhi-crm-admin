import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import jwt from 'jsonwebtoken';
import pool from '../../../config/db';
import { getAdminAccountState, modulesForRoles } from '../../../middleware/permissions';
import { PgNotifyBus } from './pgNotifyBus';
import { DEFAULT_SSE_CONFIG, PushRow, SseHub, SseHubConfig } from './sseHub';
import type { RealtimeEvent, RecipientType } from './types';

export type { RealtimeEvent } from './types';

const intFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export function sseConfigFromEnv(): SseHubConfig {
  return {
    ...DEFAULT_SSE_CONFIG,
    heartbeatMs: intFromEnv('SSE_HEARTBEAT_MS', DEFAULT_SSE_CONFIG.heartbeatMs),
    maxPerUser: intFromEnv('SSE_MAX_PER_USER', DEFAULT_SSE_CONFIG.maxPerUser),
    maxConnections: intFromEnv('SSE_MAX_CONNECTIONS', DEFAULT_SSE_CONFIG.maxConnections),
  };
}

// Same database as the app pool unless LISTEN_DATABASE_URL points LISTEN at a session-mode connection.
export function listenConnectionString(): string {
  return process.env.LISTEN_DATABASE_URL || (pool as unknown as { options: { connectionString: string } }).options.connectionString;
}

export async function fetchPushRows(ids: string[]): Promise<PushRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, type, title, body, entity_type, entity_id, created_at, module, data->>'orderId' AS order_id, admin_id, customer_id
       FROM notifications WHERE id = ANY($1::bigint[])`,
    [ids]
  );
  return rows;
}

export async function adminVisibility(adminId: string) {
  const state = await getAdminAccountState(adminId);
  if (!state || !state.isActive || state.deleted) return null;
  return { modules: modulesForRoles(state.assignedRoles), assignedRoles: state.assignedRoles };
}

let instance: { bus: PgNotifyBus; hub: SseHub } | null = null;

export function getRealtime() {
  if (!instance) {
    const bus = new PgNotifyBus({ connectionString: listenConnectionString() });
    const hub = new SseHub(sseConfigFromEnv(), { bus, fetchRows: fetchPushRows, adminVisibility });
    instance = { bus, hub };
  }
  return instance;
}

// Publishing points call this inside their transaction: NOTIFY is delivered only on COMMIT.
export async function publishRealtime(events: RealtimeEvent[], client: PoolClient) {
  if (events.length === 0) return;
  await getRealtime().bus.publish(events, client);
}

// LISTEN failures are logged and retried by the bus; REST keeps working and clients poll meanwhile.
export async function startRealtime() {
  await getRealtime().bus.start();
}

export async function stopRealtime() {
  if (!instance) return;
  instance.hub.shutdown();
  await instance.bus.stop();
}

function tokenExpiryMs(req: Request): number | null {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = token ? jwt.decode(token) : null;
  return decoded && typeof decoded === 'object' && typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
}

// GET …/notifications/stream. Runs after the router's auth middleware (admin: also the account check).
export function createStreamHandler(hub: SseHub, recipientType: RecipientType) {
  return (req: Request, res: Response) => {
    const recipientId = recipientType === 'admin' ? req.admin!.id : req.customer!.id;
    const admission = hub.admit(recipientType, recipientId);
    if (!admission.ok) {
      res.setHeader('Retry-After', '60');
      return res.status(admission.status).json({ success: false, message: admission.message });
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    hub.register(req, res, recipientType, recipientId, tokenExpiryMs(req), recipientType === 'admin' ? req.admin!.activeRole : null);
  };
}
