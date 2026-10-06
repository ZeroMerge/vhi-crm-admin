import { createContext, useCallback, useContext } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@/services/notification.service';

// React Query is used for notifications only; other admin data still uses services + useEffect.
export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
};

// True while a realtime notification stream is open (in this tab or, via the leader tab, in another one).
// Provided by components/layout/NotificationStreamProvider.tsx.
export const NotificationStreamContext = createContext(false);

// Polls every 60s only while the realtime stream is down; React Query also pauses polling in hidden tabs.
export function useUnreadNotificationCount() {
  const streaming = useContext(NotificationStreamContext);
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: notificationService.unreadCount,
    refetchInterval: streaming ? false : 60_000,
  });
}

// Loaded only while the dropdown is open.
export function useNotificationList(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ pageParam }) => notificationService.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    // One retry, so the error state shows quickly instead of after the default three.
    retry: 1,
  });
}

export function useInvalidateNotifications() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: notificationKeys.all }), [queryClient]);
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({ mutationFn: notificationService.markRead, onSettled: invalidate });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({ mutationFn: notificationService.markAllRead, onSettled: invalidate });
}
