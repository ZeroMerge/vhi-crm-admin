import api from './api';
import type { ApiResponse, Shipment, TrackingUpdate } from '@/types';

export const trackingService = {
  list: async (filters?: { search?: string; filter?: string; mode?: string }): Promise<Shipment[]> => {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') params.append(key, String(value));
      });
    }
    const res = await api.get<ApiResponse<Shipment[]>>(`/api/admin/tracking?${params}`);
    return res.data.data;
  },
  getPending: async (): Promise<Shipment[]> => {
    const res = await api.get<ApiResponse<Shipment[]>>('/api/admin/tracking/pending');
    return res.data.data;
  },
  addUpdate: async (shipmentId: string, status: string, message?: string): Promise<TrackingUpdate> => {
    const res = await api.post<ApiResponse<TrackingUpdate>>(`/api/admin/tracking/${shipmentId}/update`, { status, message });
    return res.data.data;
  },
  getEvents: async (shipmentId: string): Promise<TrackingUpdate[]> => {
    const res = await api.get<ApiResponse<TrackingUpdate[]>>(`/api/admin/tracking/${shipmentId}/events`);
    return res.data.data;
  },
  publicLookup: async (trackingId: string): Promise<Shipment> => {
    const res = await api.get<ApiResponse<Shipment>>(`/api/tracking/${trackingId}`);
    return res.data.data;
  },
};
