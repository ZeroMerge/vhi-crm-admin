// Pure cache-update planning for pushed notification events (no imports, no I/O).
// This file is byte-identical in admin/app/src/lib/ and client/src/lib/; the backend test runner checks it.
//
// Rules:
// - If a fetch for a query is in flight when a push arrives, that query is invalidated (cancelRefetch) instead
//   of patched, so the push cannot be overwritten by an older response.
// - The list is patched in place and deduped by id.
// - The unread count is incremented only when the pushed id is newer than `latestId` (the highest id the last
//   count query could see), which proves it was not counted yet. Anything else is ambiguous (out-of-order
//   commits, reads that may already be counted) and the count is refetched instead.

export interface PushedNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  orderId?: string;
}

export type PushEvent =
  | { type: 'notification'; notification: PushedNotification }
  | { type: 'read'; ids: string[] }
  | { type: 'read_all'; ids: string[] }
  | { type: 'replaced'; removedIds: string[]; addedIds: string[] };

export interface ListItem {
  id: string;
  readAt: string | null;
}

export interface ListPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface InfiniteList<T> {
  pages: ListPage<T>[];
  pageParams: unknown[];
}

export interface CountCache {
  count: number;
  latestId: string | null;
}

export interface CacheState<T> {
  list: InfiniteList<T> | undefined;
  listFetching: boolean;
  count: CountCache | undefined;
  countFetching: boolean;
}

export interface CachePlan<T> {
  // Present only when that cache should be replaced with the given value.
  list?: InfiniteList<T>;
  count?: CountCache;
  invalidateList: boolean;
  invalidateCount: boolean;
}

const isNewer = (id: string, than: string | null) => than === null || BigInt(id) > BigInt(than);

function mapItems<T extends ListItem>(list: InfiniteList<T>, fn: (item: T) => T | null): InfiniteList<T> {
  return {
    ...list,
    pages: list.pages.map((page) => ({
      ...page,
      data: page.data.map(fn).filter((item): item is T => item !== null),
    })),
  };
}

const listHas = <T extends ListItem>(list: InfiniteList<T>, id: string) => list.pages.some((p) => p.data.some((n) => n.id === id));

export function planPushUpdate<T extends ListItem>(
  state: CacheState<T>,
  event: PushEvent,
  toListItem: (n: PushedNotification) => T,
  now: string
): CachePlan<T> {
  const plan: CachePlan<T> = { invalidateList: false, invalidateCount: false };

  // ---- list
  if (state.list) {
    if (state.listFetching) {
      plan.invalidateList = true;
    } else if (event.type === 'notification') {
      if (!listHas(state.list, event.notification.id)) {
        const [first, ...rest] = state.list.pages;
        const firstPage = first ?? { data: [], nextCursor: null };
        plan.list = {
          ...state.list,
          pages: [{ ...firstPage, data: [toListItem(event.notification), ...firstPage.data] }, ...rest],
        };
      }
    } else if (event.type === 'read' || event.type === 'read_all') {
      const ids = new Set(event.ids);
      plan.list = mapItems(state.list, (n) => (ids.has(n.id) && !n.readAt ? { ...n, readAt: now } : n));
    } else if (event.type === 'replaced') {
      const removed = new Set(event.removedIds);
      plan.list = mapItems(state.list, (n) => (removed.has(n.id) ? null : n));
    }
  }

  // ---- count
  if (state.count) {
    if (state.countFetching) {
      plan.invalidateCount = true;
    } else if (event.type === 'notification' && isNewer(event.notification.id, state.count.latestId)) {
      plan.count = { count: state.count.count + 1, latestId: event.notification.id };
    } else {
      plan.invalidateCount = true;
    }
  }

  return plan;
}
