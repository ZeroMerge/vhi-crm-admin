import api from './api';
import type { ApiResponse, Communication, Customer } from '@/types';

export interface CommunicationThread {
  customer: Customer;
  messages: Communication[];
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: string;
}

// The server returns raw rows (created_at, customer_id, …) with senderType added. Pages and the live merge use camelCase fields.
type Row = Record<string, unknown>;
export const toCommunication = (row: Row): Communication => ({
  ...(row as unknown as Communication),
  id: String(row.id),
  customerId: String(row.customerId ?? row.customer_id ?? ''),
  sentBy: String(row.sentBy ?? row.sent_by ?? ''),
  subject: String(row.subject ?? ''),
  body: String(row.body ?? ''),
  isRead: Boolean(row.isRead ?? row.is_read ?? false),
  createdAt: String(row.createdAt ?? row.created_at ?? ''),
});

export const communicationService = {
  getAll: async (filters?: { search?: string; filter?: string; sortBy?: string; industry?: string }): Promise<CommunicationThread[]> => {
    const res = await api.get<ApiResponse<CommunicationThread[]>>('/api/admin/communications', { params: filters });
    return res.data.data;
  },
  // Loading a thread never marks it read (markRead=false): the Communications page reports what it displayed with markThreadRead,
  // so other readers (e.g. finance on a customer's page) never clear the inbox's unread counts.
  getThread: async (customerId: string): Promise<Communication[]> => {
    const res = await api.get<ApiResponse<Row[]>>(`/api/admin/communications/${customerId}`, { params: { markRead: false } });
    return res.data.data.map(toCommunication);
  },
  // Only these messages of THIS customer's thread (the server leaves out any other id). Used to append what a push announced.
  getThreadMessages: async (customerId: string, ids: string[]): Promise<Communication[]> => {
    const res = await api.get<ApiResponse<Row[]>>(`/api/admin/communications/${customerId}`, { params: { ids: ids.join(',') } });
    return res.data.data.map(toCommunication);
  },
  // Marks exactly these customer messages read (the ids that were displayed). Needs the communications module.
  markThreadRead: async (customerId: string, messageIds: string[]): Promise<void> => {
    await api.post(`/api/admin/communications/${customerId}/read`, { messageIds });
  },
  send: async (data: { customerId: string; subject: string; body: string }): Promise<Communication> => {
    const res = await api.post<ApiResponse<Row>>('/api/admin/communications/send', data);
    return toCommunication(res.data.data);
  },
  delete: async (messageId: string): Promise<void> => {
    await api.delete(`/api/admin/communications/${messageId}`);
  },
};


export const newsletterService = {
  getSegments: async (): Promise<{ industry: string; count: number; customers: Customer[] }[]> => {
    const res = await api.get<ApiResponse<{ industry: string; count: number; customers: Customer[] }[]>>('/api/admin/newsletter/segments');
    return res.data.data;
  },
  moveSegment: async (customerId: string, toIndustry: string): Promise<void> => {
    await api.put('/api/admin/newsletter/segments/move', { customerId, toIndustry });
  },
  removeFromSegment: async (customerId: string): Promise<void> => {
    await api.delete('/api/admin/newsletter/segments/remove', { data: { customerId } });
  },
  previewCount: async (data: { segments: string[]; status?: string }): Promise<number> => {
    const res = await api.post<{ success: boolean; count: number }>('/api/admin/newsletter/preview-count', data);
    return res.data.count;
  },
  send: async (data: { subject: string; body: string; segments: string[]; status?: string }): Promise<void> => {
    await api.post('/api/admin/newsletter/send', data);
  },
  getHistory: async (): Promise<{ id: string; subject: string; segment: string; recipientCount: number; sentAt: string }[]> => {
    const res = await api.get<ApiResponse<{ id: string; subject: string; segment: string; recipientCount: number; sentAt: string }[]>>('/api/admin/newsletter/history');
    return res.data.data;
  },
};
