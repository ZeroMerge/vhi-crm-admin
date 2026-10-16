import { Client, PoolClient } from 'pg';
import { isThreadEvent, NotificationRealtimeEvent, RealtimeBus, RealtimeEvent, RealtimeHandler } from './types';

export const NOTIFY_CHANNEL = 'vhi_notifications';
// Postgres caps a NOTIFY payload at 8000 bytes; stay well under it.
export const MAX_PAYLOAD_BYTES = 7500;

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

// Halves an event's id lists until each piece fits on its own.
function splitEvent(event: RealtimeEvent, maxBytes: number): RealtimeEvent[] {
  // Thread events are a few fixed-size ids: they always fit.
  if (isThreadEvent(event) || bytes([event]) <= maxBytes) return [event];
  return splitNotificationEvent(event, maxBytes);
}

function splitNotificationEvent(event: NotificationRealtimeEvent, maxBytes: number): NotificationRealtimeEvent[] {
  if (bytes([event]) <= maxBytes) return [event];
  const ids = event.notificationIds;
  const replaced = event.replacedIds ?? [];
  if (ids.length <= 1 && replaced.length <= 1) {
    throw new Error('A single notification id does not fit in a NOTIFY payload');
  }
  const half = (list: string[]) => [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))];
  const [idsA, idsB] = half(ids);
  const [repA, repB] = half(replaced);
  const a: NotificationRealtimeEvent = { ...event, notificationIds: idsA, ...(event.replacedIds ? { replacedIds: repA } : {}) };
  const b: NotificationRealtimeEvent = { ...event, notificationIds: idsB, ...(event.replacedIds ? { replacedIds: repB } : {}) };
  return [...splitNotificationEvent(a, maxBytes), ...splitNotificationEvent(b, maxBytes)].filter(
    (e) => e.notificationIds.length > 0 || (e.replacedIds?.length ?? 0) > 0
  );
}

// Packs events into as few JSON-array payloads as possible, each at most maxBytes (UTF-8).
export function chunkEvents(events: RealtimeEvent[], maxBytes = MAX_PAYLOAD_BYTES): string[] {
  const payloads: string[] = [];
  let current: RealtimeEvent[] = [];
  for (const event of events.flatMap((e) => splitEvent(e, maxBytes))) {
    if (current.length > 0 && bytes([...current, event]) > maxBytes) {
      payloads.push(JSON.stringify(current));
      current = [];
    }
    current.push(event);
  }
  if (current.length > 0) payloads.push(JSON.stringify(current));
  return payloads;
}

// LISTEN needs a session-level connection; a transaction-mode pooler (often port 6543, or pgbouncer=true) silently breaks it.
export function looksLikeTransactionPooler(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.port === '6543' || url.searchParams.get('pgbouncer') === 'true';
  } catch {
    return false;
  }
}

export interface PgNotifyBusOptions {
  connectionString: string;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  log?: Pick<Console, 'warn' | 'error' | 'info'>;
}

export class PgNotifyBus implements RealtimeBus {
  private handlers = new Set<RealtimeHandler>();
  // Extra channels LISTENed on the same connection (e.g. the email worker's wake-ups), re-applied on every reconnect.
  private channelHandlers = new Map<string, Set<(payload: string) => void>>();
  private client: Client | null = null;
  private listening = false;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly log: Pick<Console, 'warn' | 'error' | 'info'>;

  constructor(private readonly options: PgNotifyBusOptions) {
    this.minBackoff = options.minBackoffMs ?? 1000;
    this.maxBackoff = options.maxBackoffMs ?? 30000;
    this.log = options.log ?? console;
  }

  async publish(events: RealtimeEvent[], client: PoolClient): Promise<void> {
    if (events.length === 0) return;
    for (const payload of chunkEvents(events)) {
      await client.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, payload]);
    }
  }

  subscribe(handler: RealtimeHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * LISTENs to another channel on this bus's connection. Delivery is best effort (nothing while disconnected),
   * so listeners must also poll. Returns an unsubscribe function (the LISTEN itself stays until reconnect/stop).
   */
  listenTo(channel: string, handler: (payload: string) => void): () => void {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(channel) || channel === NOTIFY_CHANNEL) throw new Error(`invalid LISTEN channel: ${channel}`);
    let set = this.channelHandlers.get(channel);
    if (!set) {
      set = new Set();
      this.channelHandlers.set(channel, set);
      const client = this.client;
      if (client && this.listening) {
        client.query(`LISTEN ${channel}`).catch((err) => this.log.error(`[realtime] LISTEN ${channel} failed`, err));
      }
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  isListening(): boolean {
    return this.listening;
  }

  // Backend pid of the LISTEN connection (tests use it to simulate a dropped connection).
  listenerPid(): number | null {
    return (this.client as unknown as { processID?: number } | null)?.processID ?? null;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    if (looksLikeTransactionPooler(this.options.connectionString)) {
      this.log.warn(
        '[realtime] WARNING: LISTEN_DATABASE_URL/DATABASE_URL looks like a transaction pooler (port 6543 or pgbouncer=true). ' +
          'LISTEN/NOTIFY will not work through it; set LISTEN_DATABASE_URL to a session-mode connection. Clients will fall back to polling.'
      );
    }
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.listening = false;
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      client.on('error', () => {}); // ignore errors raised while closing
      await client.end().catch(() => {});
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: this.options.connectionString });
    this.client = client;
    const onDown = (reason: unknown) => {
      if (this.client !== client) return; // stale client
      this.listening = false;
      this.client = null;
      client.removeAllListeners();
      client.on('error', () => {});
      client.end().catch(() => {});
      if (!this.stopped) {
        this.log.warn(`[realtime] LISTEN connection lost (${reason instanceof Error ? reason.message : String(reason)}); reconnecting`);
        this.scheduleReconnect();
      }
    };
    client.on('error', onDown);
    client.on('end', () => onDown('connection ended'));
    client.on('notification', (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL) {
        for (const handler of this.channelHandlers.get(msg.channel) ?? []) {
          try {
            handler(msg.payload ?? '');
          } catch (err) {
            this.log.error(`[realtime] ${msg.channel} handler failed`, err);
          }
        }
        return;
      }
      if (!msg.payload) return;
      let events: RealtimeEvent[];
      try {
        events = JSON.parse(msg.payload);
      } catch {
        this.log.error('[realtime] ignored a malformed NOTIFY payload');
        return;
      }
      for (const handler of this.handlers) {
        try {
          handler(events);
        } catch (err) {
          this.log.error('[realtime] handler failed', err);
        }
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      for (const channel of this.channelHandlers.keys()) await client.query(`LISTEN ${channel}`);
      if (this.client !== client || this.stopped) return;
      this.listening = true;
      this.attempt = 0;
      this.log.info?.('[realtime] listening for notification events');
    } catch (err) {
      onDown(err);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.stopped) return;
    const base = Math.min(this.maxBackoff, this.minBackoff * 2 ** this.attempt);
    const delay = Math.round(base / 2 + Math.random() * (base / 2)); // jitter in [base/2, base]
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
