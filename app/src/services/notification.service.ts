import api from './api';
import type { ApiResponse } from '@/types';

export interface AppNotification {
  id: string;
  type: string;
  module: string | null;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface UnreadCount {
  count: number;
  latestId: string | null;
}

export interface NotificationPage {
  data: AppNotification[];
  nextCursor: string | null;
}

export const notificationService = {
  list: async (before?: string, limit = 20): Promise<NotificationPage> => {
    const res = await api.get<ApiResponse<AppNotification[]> & { nextCursor: string | null }>('/api/admin/notifications', {
      params: { before, limit },
    });
    return { data: res.data.data, nextCursor: res.data.nextCursor };
  },
  // latestId: the highest id this count could see; the realtime stream uses it to avoid double-counting.
  unreadCount: async (): Promise<UnreadCount> => {
    const res = await api.get<ApiResponse<{ count: number; latestId?: string | null }>>('/api/admin/notifications/unread-count');
    return { count: res.data.data.count, latestId: res.data.data.latestId ?? null };
  },
  markRead: async (id: string): Promise<AppNotification> => {
    const res = await api.post<ApiResponse<AppNotification>>(`/api/admin/notifications/${id}/read`);
    return res.data.data;
  },
  markAllRead: async (): Promise<number> => {
    const res = await api.post<ApiResponse<{ updated: number }>>('/api/admin/notifications/read-all');
    return res.data.data.updated;
  },
};
