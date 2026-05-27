import api from './api';
import type { ApiResponse } from '@/types';

export interface ReportData {
  newUsers: number;
  pendingShipments: number;
  totalEnquiries: number;
  revenue: number;
  shipmentBreakdown: Array<{ mode: string; count: number | string; value: number | string }>;
  customerBreakdown: Array<{ status: string; count: number | string }>;
}

export const reportService = {
  getReport: async (period: string): Promise<ReportData> => {
    const res = await api.get<ApiResponse<ReportData>>(`/api/admin/reports/${period}`);
    return res.data.data;
  },
  exportReport: async (period: string): Promise<Blob> => {
    const res = await api.get(`/api/admin/reports/export`, {
      params: { period },
      responseType: 'blob'
    });
    return res.data;
  }
};
