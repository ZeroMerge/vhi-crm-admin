import api from './api';
import type { ApiResponse, Shipment, PaginatedResponse, ShipmentDocument } from '@/types';

interface ShipmentFilters {
  status?: string;
  mode?: string;
  customerId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  page?: number;
  pageSize?: number;
}

export const shipmentService = {
  list: async (filters?: ShipmentFilters): Promise<PaginatedResponse<Shipment>> => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
    }
    const res = await api.get<any>(`/api/admin/shipments?${params}`);
    return {
      data: res.data.data || [],
      total: res.data.pagination?.total ?? 0,
      page: res.data.pagination?.page ?? 1,
      pageSize: res.data.pagination?.pageSize ?? 10,
      totalPages: res.data.pagination?.totalPages ?? 1,
    };
  },
  getById: async (id: string): Promise<Shipment> => {
    const res = await api.get<ApiResponse<Shipment>>(`/api/admin/shipments/${id}`);
    return res.data.data;
  },
  updateStatus: async (id: string, status: string, message?: string): Promise<Shipment> => {
    const res = await api.put<ApiResponse<Shipment>>(`/api/admin/shipments/${id}/status`, { status, message });
    return res.data.data;
  },
  updateTracking: async (id: string, data: { awbNumber?: string; bolNumber?: string; uniqueId?: string }): Promise<Shipment> => {
    const res = await api.put<ApiResponse<Shipment>>(`/api/admin/shipments/${id}/tracking`, data);
    return res.data.data;
  },
  uploadDocument: async (id: string, file: File, documentType: string): Promise<ShipmentDocument> => {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('documentType', documentType);
    const res = await api.post<ApiResponse<ShipmentDocument>>(`/api/admin/shipments/${id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data;
  },
  deleteDocument: async (shipmentId: string, docId: string): Promise<void> => {
    await api.delete(`/api/admin/shipments/${shipmentId}/documents/${docId}`);
  },
};
