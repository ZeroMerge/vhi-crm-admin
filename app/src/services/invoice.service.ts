import api from './api';
import type { ApiResponse, Invoice, PaginatedResponse, Payment } from '@/types';

interface InvoiceFilters {
  status?: string;
  currency?: string;
  customerId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  overdue?: string;
  sortBy?: string;
  page?: number;
  pageSize?: number;
}

interface CreateInvoiceData {
  customerId: string;
  shipmentId: string;
  amount: number;
  currency: string;
  dueDate: string;
  notes?: string;
}

export const invoiceService = {
  list: async (filters?: InvoiceFilters): Promise<PaginatedResponse<Invoice>> => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
    }
    const res = await api.get<any>(`/api/admin/invoices?${params}`);
    return {
      data: res.data.data || [],
      total: res.data.pagination?.total ?? 0,
      page: res.data.pagination?.page ?? 1,
      pageSize: res.data.pagination?.pageSize ?? 10,
      totalPages: res.data.pagination?.totalPages ?? 1,
    };
  },
  getById: async (id: string): Promise<Invoice> => {
    const res = await api.get<ApiResponse<Invoice>>(`/api/admin/invoices/${id}`);
    return res.data.data;
  },
  create: async (data: CreateInvoiceData): Promise<Invoice> => {
    const res = await api.post<ApiResponse<Invoice>>('/api/admin/invoices', data);
    return res.data.data;
  },
  updateStatus: async (id: string, status: string): Promise<Invoice> => {
    const res = await api.put<ApiResponse<Invoice>>(`/api/admin/invoices/${id}/status`, { status });
    return res.data.data;
  },
  recordPayment: async (id: string, data: { amount: number; paymentMethod: string; notes?: string }): Promise<Payment> => {
    const res = await api.put<ApiResponse<Payment>>(`/api/admin/invoices/${id}/payment`, data);
    return res.data.data;
  },
  downloadPDF: async (id: string): Promise<Blob> => {
    const res = await api.get(`/api/admin/invoices/${id}/pdf`, { responseType: 'blob' });
    return res.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/admin/invoices/${id}`);
  },
};
