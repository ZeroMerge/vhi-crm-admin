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
  unreadCount: async (): Promise<number> => {
    const res = await api.get<ApiResponse<{ count: number }>>('/api/admin/notifications/unread-count');
    return res.data.data.count;
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
