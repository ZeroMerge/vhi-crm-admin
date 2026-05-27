import api from './api';
import type { ApiResponse, Payment, PaginatedResponse } from '@/types';

export const paymentService = {
  list: async (filters?: { page?: number; pageSize?: number; status?: string }): Promise<PaginatedResponse<Payment>> => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) params.append(key, String(value));
      });
    }
    const res = await api.get<any>(`/api/admin/payments?${params}`);
    return {
      data: res.data.data || [],
      total: res.data.pagination?.total ?? 0,
      page: res.data.pagination?.page ?? 1,
      pageSize: res.data.pagination?.pageSize ?? 10,
      totalPages: res.data.pagination?.totalPages ?? 1,
    };
  },
  initializePaystack: async (data: { invoiceId: string; email: string; amount: number; currency: string }): Promise<{ authorization_url: string; reference: string }> => {
    const res = await api.post<ApiResponse<{ authorization_url: string; reference: string }>>('/api/payments/paystack/initialize', data);
    return res.data.data;
  },
  verifyPaystack: async (reference: string): Promise<Payment> => {
    const res = await api.post<ApiResponse<Payment>>('/api/payments/paystack/verify', { reference });
    return res.data.data;
  },
  createStripeIntent: async (data: { invoiceId: string; amount: number; currency: string }): Promise<{ clientSecret: string }> => {
    const res = await api.post<ApiResponse<{ clientSecret: string }>>('/api/payments/stripe/intent', data);
    return res.data.data;
  },
  confirmStripe: async (paymentIntentId: string): Promise<Payment> => {
    const res = await api.post<ApiResponse<Payment>>('/api/payments/stripe/confirm', { paymentIntentId });
    return res.data.data;
  },
};
