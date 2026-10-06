// Notification stream client: fetch-based SSE with reconnects, and one stream per browser (not per tab):
// the tab holding a Web Lock is the leader and relays events to the other tabs over a BroadcastChannel.
// Without Web Locks or BroadcastChannel every tab connects on its own.
// This file is byte-identical in admin/app/src/lib/ and client/src/lib/; the backend test runner checks it.
import { initialSseState, parseSse } from './sseParser';
import type { PushEvent, PushedNotification } from './notificationCache';

export type StreamEvent = { type: 'ready' } | PushEvent;

// ---------------------------------------------------------------- retry policy (pure)

export type Outcome =
  | { kind: 'unauthorized' } // 401 or no token: stop and hand over to the app's session-expired flow
  | { kind: 'throttled'; retryAfterMs: number | null } // 429 / 503
  | { kind: 'reauth'; sameToken: boolean; expiresAtMs: number | null } // server asked for a fresh token
  | { kind: 'ended' } // the server closed a stream that had been ready (deploy, restart)
  | { kind: 'failed' }; // network error, other status, idle timeout

export interface RetryState {
  attempt: number; // consecutive failed attempts, reset by `ready`
  reauthStreak: number; // consecutive `reauth` outcomes with an unchanged token
}

export const RETRY = { minMs: 1_000, maxMs: 30_000, throttledMs: 60_000, cleanEndJitterMs: 5_000, expiryGraceMs: 1_000 };

export const initialRetryState: RetryState = { attempt: 0, reauthStreak: 0 };

/** Delay before the next attempt (null = stop) and the next state. */
export function nextRetry(
  state: RetryState,
  outcome: Outcome,
  random: () => number,
  now: number
): { delayMs: number | null; state: RetryState } {
  const backoff = () => Math.round(Math.min(RETRY.maxMs, RETRY.minMs * 2 ** state.attempt) * (0.5 + random() / 2));
  switch (outcome.kind) {
    case 'unauthorized':
      return { delayMs: null, state };
    case 'throttled':
      return { delayMs: outcome.retryAfterMs ?? RETRY.throttledMs, state };
    case 'ended':
      // Spread reconnects after a server restart instead of every client arriving at once.
      return { delayMs: Math.round(random() * RETRY.cleanEndJitterMs), state: { attempt: 0, reauthStreak: 0 } };
    case 'failed':
      return { delayMs: backoff(), state: { ...state, attempt: state.attempt + 1 } };
    case 'reauth': {
      const streak = outcome.sameToken ? state.reauthStreak + 1 : 1;
      // First `reauth`: reconnect at once with the current token (a revoked account then gets 401).
      // Again with the same token: there is no token refresh, so wait until it expires (the reconnect then
      // gets 401) instead of reconnecting in a loop.
      if (streak <= 1) return { delayMs: 0, state: { ...state, reauthStreak: streak } };
      const delayMs = outcome.expiresAtMs === null ? backoff() : Math.max(0, outcome.expiresAtMs - now) + RETRY.expiryGraceMs;
      return { delayMs, state: { ...state, reauthStreak: streak } };
    }
  }
}

/** JWT `exp` in ms, or null if the token is not a readable JWT. Not verified: only used to time a reconnect. */
export function tokenExpiryMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Maps one SSE message to a push event; unknown or malformed messages are dropped. */
export function toPushEvent(event: string, data: string): PushEvent | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (event === 'notification') {
    return typeof body.id === 'string' ? { type: 'notification', notification: body as unknown as PushedNotification } : null;
  }
  if (event === 'read' || event === 'read_all') {
    return isStringArray(body.ids) ? { type: event, ids: body.ids } : null;
  }
  if (event === 'replaced') {
    return isStringArray(body.removedIds) && isStringArray(body.addedIds)
      ? { type: 'replaced', removedIds: body.removedIds, addedIds: body.addedIds }
      : null;
  }
  return null;
}

// ---------------------------------------------------------------- one connection loop

export interface NotificationStreamOptions {
  url: string;
  getToken: () => string | null;
  onEvent: (event: StreamEvent) => void;
  /** True between `ready` and the stream closing (in any tab, when shared). Poll while false. */
  onConnectedChange: (connected: boolean) => void;
  /** 401 or no token: the stream has stopped; run the app's session-expired flow. */
  onUnauthorized: () => void;
  /** Lock and channel name shared by this app's tabs. */
  name: string;
  /** No bytes (not even a heartbeat) for this long → reconnect. The server sends one every 25s by default. */
  idleTimeoutMs?: number;
  fetch?: typeof fetch;
  random?: () => number;
  now?: () => number;
  /** Injected for tests; default to the browser's. Null disables sharing (every tab connects). */
  locks?: Pick<LockManager, 'request'> | null;
  createChannel?: ((name: string) => BroadcastChannel) | null;
}

export interface NotificationStream {
  stop(): void;
}

interface Loop {
  stop(): void;
}

function runLoop(o: NotificationStreamOptions, onStopped: () => void): Loop {
  const doFetch = o.fetch ?? fetch.bind(globalThis);
  const random = o.random ?? Math.random;
  const now = o.now ?? Date.now;
  const idleTimeoutMs = o.idleTimeoutMs ?? 90_000;
  const doc = typeof document === 'undefined' ? null : document;

  let stopped = false;
  let connected = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retry = initialRetryState;
  let lastOutcome: Outcome['kind'] | null = null;

  const setConnected = (value: boolean) => {
    if (value === connected) return;
    connected = value;
    o.onConnectedChange(value);
  };

  const finish = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    controller?.abort();
    doc?.removeEventListener('visibilitychange', onVisible);
    setConnected(false);
  };

  // Back on the tab after a network failure: retry now instead of waiting out the backoff.
  function onVisible() {
    if (doc?.visibilityState === 'visible' && timer && lastOutcome === 'failed') {
      clearTimeout(timer);
      timer = null;
      void connect();
    }
  }
  doc?.addEventListener('visibilitychange', onVisible);

  async function connect() {
    if (stopped) return;
    const token = o.getToken();
    let outcome: Outcome = { kind: 'failed' };
    if (!token) {
      outcome = { kind: 'unauthorized' };
    } else {
      const ac = new AbortController();
      controller = ac;
      let idle: ReturnType<typeof setTimeout> | null = null;
      const touch = () => {
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => ac.abort(), idleTimeoutMs);
      };
      try {
        touch();
        const res = await doFetch(o.url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          cache: 'no-store',
          signal: ac.signal,
        });
        if (res.status === 401) {
          outcome = { kind: 'unauthorized' };
        } else if (res.status === 429 || res.status === 503) {
          const seconds = Number(res.headers.get('Retry-After'));
          outcome = { kind: 'throttled', retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null };
        } else if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let parser = initialSseState;
          let ready = false;
          let reauth = false;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            touch();
            const out = parseSse(parser, decoder.decode(value, { stream: true }));
            parser = out.state;
            for (const m of out.messages) {
              if (stopped) break;
              if (m.event === 'ready') {
                ready = true;
                retry = { ...retry, attempt: 0 };
                setConnected(true);
                o.onEvent({ type: 'ready' });
              } else if (m.event === 'reauth') {
                reauth = true;
              } else {
                const event = toPushEvent(m.event, m.data);
                if (event) o.onEvent(event);
              }
            }
          }
          outcome = reauth
            ? { kind: 'reauth', sameToken: o.getToken() === token, expiresAtMs: tokenExpiryMs(token) }
            : ready
              ? { kind: 'ended' }
              : { kind: 'failed' };
        }
      } catch {
        outcome = { kind: 'failed' }; // network error, idle timeout or stop()
      } finally {
        if (idle) clearTimeout(idle);
        if (controller === ac) controller = null;
      }
    }
    if (stopped) return;
    setConnected(false);
    lastOutcome = outcome.kind;
    const next = nextRetry(retry, outcome, random, now());
    retry = next.state;
    if (next.delayMs === null) {
      finish();
      onStopped();
      o.onUnauthorized();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, next.delayMs);
  }

  void connect();
  return { stop: finish };
}

// ---------------------------------------------------------------- one stream per browser

type ChannelMessage = { type: 'event'; event: StreamEvent } | { type: 'status'; connected: boolean } | { type: 'hello' };

export function startNotificationStream(o: NotificationStreamOptions): NotificationStream {
  const locks = o.locks === undefined ? (typeof navigator !== 'undefined' ? navigator.locks ?? null : null) : o.locks;
  const createChannel =
    o.createChannel === undefined
      ? typeof BroadcastChannel === 'undefined'
        ? null
        : (name: string) => new BroadcastChannel(name)
      : o.createChannel;

  if (!locks || !createChannel) {
    const loop = runLoop(o, () => {});
    return { stop: () => loop.stop() };
  }

  const channel = createChannel(o.name);
  const abort = new AbortController();
  let stopped = false;
  let leader: Loop | null = null;
  let releaseLock: (() => void) | null = null;
  let connected = false;

  const setConnected = (value: boolean) => {
    if (value === connected) return;
    connected = value;
    o.onConnectedChange(value);
  };
  const post = (message: ChannelMessage) => {
    try {
      channel.postMessage(message);
    } catch {
      // channel already closed
    }
  };

  channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
    const message = e.data;
    if (leader) {
      if (message.type === 'hello') post({ type: 'status', connected });
      return;
    }
    if (message.type === 'event') o.onEvent(message.event);
    else if (message.type === 'status') setConnected(message.connected);
  };

  locks
    .request(o.name, { signal: abort.signal }, () =>
      new Promise<void>((resolve) => {
        releaseLock = resolve;
        if (stopped) return resolve();
        setConnected(false); // whatever the old leader last said, this tab now polls until its own `ready`
        leader = runLoop(
          {
            ...o,
            onEvent: (event) => {
              post({ type: 'event', event });
              o.onEvent(event);
            },
            onConnectedChange: (value) => {
              post({ type: 'status', connected: value });
              setConnected(value);
            },
          },
          // Stopped for good (401 / no token): let the next tab try; with the token gone it stops too.
          () => {
            leader = null;
            resolve();
          }
        );
      })
    )
    .catch(() => {
      // AbortError: stopped before this tab became the leader
    });

  post({ type: 'hello' });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      leader?.stop();
      leader = null;
      releaseLock?.();
      channel.onmessage = null;
      channel.close();
      setConnected(false);
    },
  };
}
