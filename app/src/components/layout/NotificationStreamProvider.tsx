import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { NotificationStreamContext, StreamEventsContext, notificationKeys } from '@/hooks/useNotifications';
import { createListeners } from '@/lib/threadSync';
import type { AppNotification, UnreadCount } from '@/services/notification.service';
import { planPushUpdate, type InfiniteList, type PushedNotification } from '@/lib/notificationCache';
import { startNotificationStream, type StreamEvent } from '@/lib/notificationStream';

// Pushed rows carry no `data`/`module`; the bell only needs entityType/entityId for links.
const toListItem = (n: PushedNotification): AppNotification => ({
  id: n.id,
  type: n.type,
  module: null,
  entityType: n.entityType,
  entityId: n.entityId,
  title: n.title,
  body: n.body,
  data: n.orderId ? { orderId: n.orderId } : {},
  readAt: null,
  createdAt: n.createdAt,
});

const isFetching = (queryClient: QueryClient, queryKey: readonly string[]) =>
  queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching';

function applyStreamEvent(queryClient: QueryClient, event: StreamEvent) {
  if (event.type === 'ready') {
    // REST is the catch-up after every (re)connect: it reflects everything committed while the stream was down.
    void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount, exact: true });
    void queryClient.invalidateQueries({ queryKey: notificationKeys.list, exact: true });
    return;
  }
  const plan = planPushUpdate<AppNotification>(
    {
      list: queryClient.getQueryData<InfiniteList<AppNotification>>(notificationKeys.list),
      listFetching: isFetching(queryClient, notificationKeys.list),
      count: queryClient.getQueryData<UnreadCount>(notificationKeys.unreadCount),
      countFetching: isFetching(queryClient, notificationKeys.unreadCount),
    },
    event,
    toListItem,
    new Date().toISOString()
  );
  if (plan.list) queryClient.setQueryData(notificationKeys.list, plan.list);
  if (plan.count) queryClient.setQueryData(notificationKeys.unreadCount, plan.count);
  // A fetch already in flight may predate this push: restart it rather than patch a cache it will overwrite.
  if (plan.invalidateList) void queryClient.invalidateQueries({ queryKey: notificationKeys.list, exact: true }, { cancelRefetch: true });
  if (plan.invalidateCount) void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount, exact: true }, { cancelRefetch: true });
}

// Opens the realtime notification stream while an admin is signed in (one stream per browser, shared by tabs)
// and keeps the bell's React Query caches up to date. While it is down, the unread count falls back to polling.
export function NotificationStreamProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const [connected, setConnected] = useState(false);
  const listeners = useMemo(() => createListeners<StreamEvent>(), []);

  useEffect(() => {
    if (!token) return;
    const stream = startNotificationStream({
      name: 'vhi-admin-notifications',
      url: `${api.defaults.baseURL}/api/admin/notifications/stream`,
      getToken: () => useAuthStore.getState().token,
      onEvent: (event) => {
        applyStreamEvent(queryClient, event);
        // Pages (Communications) subscribe to the same stream through this; it never opens another connection.
        listeners.emit(event);
      },
      onConnectedChange: setConnected,
      // Same as the axios 401 handler in services/api.ts.
      onUnauthorized: () => {
        useAuthStore.getState().logout();
        window.location.href = '/admin/login';
      },
    });
    return () => stream.stop();
  }, [queryClient, token, listeners]);

  return (
    <NotificationStreamContext.Provider value={connected}>
      <StreamEventsContext.Provider value={listeners}>{children}</StreamEventsContext.Provider>
    </NotificationStreamContext.Provider>
  );
}
