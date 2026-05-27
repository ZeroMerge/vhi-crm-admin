import api from './api';
import type { ApiResponse, Customer, PaginatedResponse, Shipment, Payment } from '@/types';

interface CustomerFilters {
  search?: string;
  industry?: string;
  star?: string;
  status?: string;
  sortBy?: string;
  page?: number;
  pageSize?: number;
}

export const customerService = {
  list: async (filters?: CustomerFilters): Promise<PaginatedResponse<Customer>> => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
    }
    const res = await api.get<any>(`/api/admin/customers?${params}`);
    return {
      data: res.data.data || [],
      total: res.data.pagination?.total ?? 0,
      page: res.data.pagination?.page ?? 1,
      pageSize: res.data.pagination?.pageSize ?? 10,
      totalPages: res.data.pagination?.totalPages ?? 1,
    };
  },
  getById: async (id: string): Promise<Customer> => {
    const res = await api.get<ApiResponse<Customer>>(`/api/admin/customers/${id}`);
    return res.data.data;
  },
  updateStar: async (id: string, starRating: number): Promise<Customer> => {
    const res = await api.put<ApiResponse<Customer>>(`/api/admin/customers/${id}/star`, { starRating });
    return res.data.data;
  },
  updateStatus: async (id: string, status: string): Promise<Customer> => {
    const res = await api.put<ApiResponse<Customer>>(`/api/admin/customers/${id}/status`, { status });
    return res.data.data;
  },
  updateSegment: async (id: string, industry: string): Promise<Customer> => {
    const res = await api.put<ApiResponse<Customer>>(`/api/admin/customers/${id}/segment`, { industry });
    return res.data.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/admin/customers/${id}`);
  },
  getShipments: async (id: string): Promise<Shipment[]> => {
    const res = await api.get<ApiResponse<Shipment[]>>(`/api/admin/customers/${id}/shipments`);
    return res.data.data;
  },
  getPayments: async (id: string): Promise<Payment[]> => {
    const res = await api.get<ApiResponse<Payment[]>>(`/api/admin/customers/${id}/payments`);
    return res.data.data;
  },
};
