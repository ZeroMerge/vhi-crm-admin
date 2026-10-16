// Pure helpers for live communications (no imports, no I/O). The push carries only ids; these decide what to fetch and how to merge.
// This file is byte-identical in admin/app/src/lib/ and client/src/lib/; the backend test runner checks it.

/** Messages are fetched by id over REST: the server answers `?ids=` with at most this many. */
export const MAX_FETCH_IDS = 50;
/** The read endpoints accept at most this many ids per call. */
export const MAX_READ_IDS = 200;
/** Pushes arriving within this window are fetched together. */
export const BATCH_MS = 150;

export interface TimedItem {
  id: string;
  createdAt: string;
}

/**
 * Adds `incoming` to `existing`, deduplicated by id (an incoming copy replaces the one already there) and ordered by time.
 * The sort is stable: items with equal (or unreadable) times keep their order, new ones after existing ones.
 */
export function mergeMessages<T extends TimedItem>(existing: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const time = (m: T) => {
    const t = Date.parse(m.createdAt);
    return Number.isNaN(t) ? Infinity : t;
  };
  return [...byId.values()]
    .map((m, i) => ({ m, i, t: time(m) }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : a.t < b.t ? -1 : 1))
    .map((x) => x.m);
}

/** Ids that are not in `known` yet (the push can arrive for a message a fetch already returned). */
export const unseenIds = (ids: readonly string[], known: ReadonlySet<string>) => [...new Set(ids)].filter((id) => !known.has(id));

export interface Batcher {
  add(id: string): void;
  cancel(): void;
}

export interface BatcherTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/** Collects ids for `delayMs`, then calls `onFlush` with them (deduplicated, in chunks of at most MAX_FETCH_IDS). */
export function createBatcher(
  onFlush: (ids: string[]) => void,
  delayMs: number = BATCH_MS,
  timers: BatcherTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
): Batcher {
  let pending = new Set<string>();
  let handle: unknown = null;
  const flush = () => {
    handle = null;
    const ids = [...pending];
    pending = new Set();
    for (let i = 0; i < ids.length; i += MAX_FETCH_IDS) onFlush(ids.slice(i, i + MAX_FETCH_IDS));
  };
  return {
    add(id) {
      pending.add(id);
      if (handle === null) handle = timers.setTimeout(flush, delayMs);
    },
    cancel() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      pending = new Set();
    },
  };
}

export interface SidedMessage {
  id: string;
  senderType?: 'admin' | 'customer';
}

/**
 * Which of the DISPLAYED messages to tell the server the reader has seen: only messages sent by the OTHER side, not already
 * reported (`sent`), and not optimistic placeholders. Never derived from time or position, so a message that arrived after the
 * list was rendered is not included until it is displayed. At most MAX_READ_IDS.
 */
export function idsToMarkRead(messages: readonly SidedMessage[], readerSide: 'admin' | 'customer', sent: ReadonlySet<string>): string[] {
  const other = readerSide === 'admin' ? 'customer' : 'admin';
  const ids: string[] = [];
  for (const m of messages) {
    if (m.senderType === other && !sent.has(m.id) && !m.id.startsWith('temp-')) ids.push(m.id);
    if (ids.length >= MAX_READ_IDS) break;
  }
  return ids;
}

export interface Listeners<E> {
  subscribe(handler: (event: E) => void): () => void;
  emit(event: E): void;
}

/** Fan-out of the one stream's events to the pages that care (no extra connection). A throwing handler never blocks the others. */
export function createListeners<E>(): Listeners<E> {
  const handlers = new Set<(event: E) => void>();
  return {
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit(event) {
      for (const h of [...handlers]) {
        try {
          h(event);
        } catch (err) {
          console.error('[stream] listener failed', err);
        }
      }
    },
  };
}
