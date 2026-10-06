import type { IncomingMessage, ServerResponse } from 'http';
import type { RealtimeBus, RealtimeEvent, RecipientType } from './types';

export interface SseHubConfig {
  heartbeatMs: number;
  maxPerUser: number;
  maxConnections: number;
  connectsPerMinute: number;
  drainTimeoutMs: number;
  // How long before token expiry to send `reauth` and end the stream.
  reauthLeadMs: number;
}

export const DEFAULT_SSE_CONFIG: SseHubConfig = {
  heartbeatMs: 25_000,
  maxPerUser: 5,
  maxConnections: 1_000,
  connectsPerMinute: 10,
  drainTimeoutMs: 30_000,
  reauthLeadMs: 60_000,
};

// Row shape the hub pushes. Whitelisted columns only: never the `data` JSON column (orderId is the one approved field).
export interface PushRow {
  id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  created_at: Date | string;
  module: string | null;
  order_id: string | null;
  admin_id: string | null;
  customer_id: string | null;
}

export interface SseHubDeps {
  bus: Pick<RealtimeBus, 'subscribe'>;
  fetchRows: (ids: string[]) => Promise<PushRow[]>;
  // Current admin access: null = account unknown/inactive/deleted; modules null = everything (super_admin).
  adminVisibility: (adminId: string) => Promise<{ modules: string[] | null; assignedRoles: string[] } | null>;
  now?: () => number;
  log?: Pick<Console, 'error'>;
}

interface Connection {
  id: number;
  key: string;
  recipientType: RecipientType;
  recipientId: string;
  res: ServerResponse;
  timers: Set<NodeJS.Timeout>;
  drainTimer: NodeJS.Timeout | null;
  onDrain: () => void;
  onClose: () => void;
  req: IncomingMessage;
  // Admin streams: the token's active role, re-checked against the current assigned roles at push time.
  activeRole: string | null;
  closed: boolean;
}

export type Admission = { ok: true } | { ok: false; status: 429 | 503; message: string };

const keyOf = (type: RecipientType, id: string) => `${type}:${id}`;

export class SseHub {
  private readonly byRecipient = new Map<string, Set<Connection>>();
  private readonly connectTimes = new Map<string, number[]>();
  private total = 0;
  private nextId = 1;
  private readonly unsubscribe: () => void;
  private readonly now: () => number;
  private readonly log: Pick<Console, 'error'>;

  constructor(private readonly config: SseHubConfig, private readonly deps: SseHubDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? console;
    this.unsubscribe = deps.bus.subscribe((events) => {
      this.handleEvents(events).catch((err) => this.log.error('[realtime] failed to route events', err));
    });
  }

  // Caps and the connect rate limit are per process (in memory).
  admit(recipientType: RecipientType, recipientId: string): Admission {
    const key = keyOf(recipientType, recipientId);
    if (this.total >= this.config.maxConnections) {
      return { ok: false, status: 503, message: 'Too many open notification streams on this server; retry later' };
    }
    if ((this.byRecipient.get(key)?.size ?? 0) >= this.config.maxPerUser) {
      return { ok: false, status: 429, message: 'Too many open notification streams for this account' };
    }
    const cutoff = this.now() - 60_000;
    const recent = (this.connectTimes.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.config.connectsPerMinute) {
      this.connectTimes.set(key, recent);
      return { ok: false, status: 429, message: 'Too many notification stream connections; retry later' };
    }
    recent.push(this.now());
    this.connectTimes.set(key, recent);
    return { ok: true };
  }

  /**
   * Registers an already-open SSE response (headers flushed by the caller) and writes `ready` in the same tick,
   * so every event published after this point reaches the connection. `expiresAtMs` is the token's exp.
   */
  register(
    req: IncomingMessage,
    res: ServerResponse,
    recipientType: RecipientType,
    recipientId: string,
    expiresAtMs: number | null,
    activeRole: string | null = null
  ) {
    const key = keyOf(recipientType, recipientId);
    const conn: Connection = {
      id: this.nextId++,
      key,
      recipientType,
      recipientId,
      res,
      req,
      activeRole,
      timers: new Set(),
      drainTimer: null,
      closed: false,
      onDrain: () => {
        if (conn.drainTimer) {
          clearTimeout(conn.drainTimer);
          conn.timers.delete(conn.drainTimer);
          conn.drainTimer = null;
        }
      },
      onClose: () => this.remove(conn),
    };
    let set = this.byRecipient.get(key);
    if (!set) this.byRecipient.set(key, (set = new Set()));
    set.add(conn);
    this.total++;

    res.on('drain', conn.onDrain);
    req.on('close', conn.onClose);

    this.write(conn, 'event: ready\ndata: {}\n\n');

    const heartbeat = setInterval(() => {
      this.write(conn, ': ping\n\n');
      // Admins: also re-check the (30s-cached) account, so a deactivated admin's stream closes even if no push arrives.
      if (recipientType === 'admin') void this.recheckAdmin(conn);
    }, this.config.heartbeatMs);
    conn.timers.add(heartbeat);

    if (expiresAtMs !== null) {
      const delay = Math.max(0, expiresAtMs - this.config.reauthLeadMs - this.now());
      const expiry = setTimeout(() => this.endWith(conn, 'reauth'), Math.min(delay, 2 ** 31 - 1));
      conn.timers.add(expiry);
    }
    return conn.id;
  }

  stats() {
    let timers = 0;
    let recipients = 0;
    for (const set of this.byRecipient.values()) {
      if (set.size > 0) recipients++;
      for (const conn of set) timers += conn.timers.size;
    }
    return { connections: this.total, recipients, timers };
  }

  // Ends every stream (e.g. on SIGTERM) so clients reconnect to the next instance.
  shutdown() {
    for (const set of [...this.byRecipient.values()]) {
      for (const conn of [...set]) {
        conn.res.end();
        this.remove(conn);
      }
    }
    this.unsubscribe();
  }

  private write(conn: Connection, chunk: string) {
    if (conn.closed) return;
    const ok = conn.res.write(chunk);
    if (!ok && !conn.drainTimer) {
      // A client that cannot keep up and never drains is dropped.
      conn.drainTimer = setTimeout(() => {
        conn.res.destroy();
        this.remove(conn);
      }, this.config.drainTimeoutMs);
      conn.timers.add(conn.drainTimer);
    }
  }

  private send(conn: Connection, event: string, data: unknown) {
    this.write(conn, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private endWith(conn: Connection, event: 'reauth') {
    if (conn.closed) return;
    this.write(conn, `event: ${event}\ndata: {}\n\n`);
    conn.res.end();
    this.remove(conn);
  }

  private remove(conn: Connection) {
    if (conn.closed) return;
    conn.closed = true;
    for (const t of conn.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    conn.timers.clear();
    conn.drainTimer = null;
    conn.res.off('drain', conn.onDrain);
    conn.req.off('close', conn.onClose);
    const set = this.byRecipient.get(conn.key);
    if (set) {
      set.delete(conn);
      if (set.size === 0) this.byRecipient.delete(conn.key);
    }
    this.total--;
  }

  private async recheckAdmin(conn: Connection) {
    try {
      const access = await this.deps.adminVisibility(conn.recipientId);
      if (!access || (conn.activeRole !== null && !access.assignedRoles.includes(conn.activeRole))) this.endWith(conn, 'reauth');
    } catch (err) {
      this.log.error('[realtime] account re-check failed', err);
    }
  }

  private connectionsFor(type: RecipientType, id: string): Connection[] {
    return [...(this.byRecipient.get(keyOf(type, id)) ?? [])];
  }

  async handleEvents(events: RealtimeEvent[]) {
    const created = new Map<string, { type: RecipientType; id: string; ids: string[] }>();
    // Sent after this batch's new rows, so a list never briefly loses a grouped message before its replacement lands.
    const replaced: RealtimeEvent[] = [];

    for (const e of events) {
      const conns = this.connectionsFor(e.recipientType, e.recipientId);
      if (conns.length === 0) continue;
      if (e.kind === 'created') {
        const key = keyOf(e.recipientType, e.recipientId);
        const entry = created.get(key) ?? { type: e.recipientType, id: e.recipientId, ids: [] };
        entry.ids.push(...e.notificationIds);
        created.set(key, entry);
      } else if (e.kind === 'replaced') {
        replaced.push(e);
      } else {
        for (const c of conns) this.send(c, e.kind, { ids: e.notificationIds });
      }
    }
    const sendReplaced = () => {
      for (const e of replaced) {
        for (const c of this.connectionsFor(e.recipientType, e.recipientId)) {
          this.send(c, 'replaced', { removedIds: e.replacedIds ?? [], addedIds: e.notificationIds });
        }
      }
    };
    if (created.size === 0) {
      sendReplaced();
      return;
    }

    // One fetch for the whole batch, not one per connection.
    const allIds = [...new Set([...created.values()].flatMap((c) => c.ids))];
    const rows = await this.deps.fetchRows(allIds);
    const byId = new Map(rows.map((r) => [String(r.id), r]));

    for (const target of created.values()) {
      const conns = this.connectionsFor(target.type, target.id);
      if (conns.length === 0) continue;
      let visible = (r: PushRow) => r.customer_id === target.id;
      if (target.type === 'admin') {
        const access = await this.deps.adminVisibility(target.id);
        // Deactivated or deleted since connecting, or the token's active role was removed: end those streams;
        // the reconnect gets 401 from the always-enforced account check.
        for (const c of conns) {
          if (!access || (c.activeRole !== null && !access.assignedRoles.includes(c.activeRole))) this.endWith(c, 'reauth');
        }
        if (!access) continue;
        visible = (r) => r.admin_id === target.id && (access.modules === null || (r.module !== null && access.modules.includes(r.module)));
      }
      for (const id of target.ids) {
        const row = byId.get(id);
        if (!row || !visible(row)) continue;
        const payload = {
          id: String(row.id),
          type: row.type,
          title: row.title,
          body: row.body,
          entityType: row.entity_type,
          entityId: row.entity_id,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
          ...(row.order_id ? { orderId: row.order_id } : {}),
        };
        for (const c of this.connectionsFor(target.type, target.id)) this.send(c, 'notification', payload);
      }
    }
    sendReplaced();
  }
}
