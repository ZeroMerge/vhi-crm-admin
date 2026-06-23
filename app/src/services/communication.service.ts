import api from './api';
import type { ApiResponse, Communication, Customer } from '@/types';

export interface CommunicationThread {
  customer: Customer;
  messages: Communication[];
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: string;
}

export const communicationService = {
  getAll: async (filters?: { search?: string; filter?: string; sortBy?: string; industry?: string }): Promise<CommunicationThread[]> => {
    const res = await api.get<ApiResponse<CommunicationThread[]>>('/api/admin/communications', { params: filters });
    return res.data.data;
  },
  getThread: async (customerId: string): Promise<Communication[]> => {
    const res = await api.get<ApiResponse<Communication[]>>(`/api/admin/communications/${customerId}`);
    return res.data.data;
  },
  send: async (data: { customerId: string; subject: string; body: string }): Promise<Communication> => {
    const res = await api.post<ApiResponse<Communication>>('/api/admin/communications/send', data);
    return res.data.data;
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
  send: async (data: { subject: string; body: string; segments: string[] }): Promise<void> => {
    await api.post('/api/admin/newsletter/send', data);
  },
  getHistory: async (): Promise<{ id: string; subject: string; segment: string; recipientCount: number; sentAt: string }[]> => {
    const res = await api.get<ApiResponse<{ id: string; subject: string; segment: string; recipientCount: number; sentAt: string }[]>>('/api/admin/newsletter/history');
    return res.data.data;
  },
};
