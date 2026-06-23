import api from './api';
import type { ApiResponse } from '@/types';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  assigned_roles: string[];
  is_active: boolean;
  created_at: string;
  last_login_at?: string;
}

export const adminManagementService = {
  list: async (): Promise<AdminUser[]> => {
    const res = await api.get<ApiResponse<AdminUser[]>>('/api/admin/admins');
    return res.data.data;
  },
  
  invite: async (data: { name: string; email: string; assignedRoles: string[] }): Promise<{ admin: AdminUser; inviteLink: string; tempPassword?: string }> => {
    const res = await api.post<ApiResponse<{ admin: AdminUser; inviteLink: string; tempPassword?: string }>>('/api/admin/admins/invite', data);
    return res.data.data;
  },
  
  updateRoles: async (id: string, assignedRoles: string[]): Promise<AdminUser> => {
    const res = await api.put<ApiResponse<AdminUser>>(`/api/admin/admins/${id}/roles`, { assignedRoles });
    return res.data.data;
  },
  
  toggleStatus: async (id: string, isActive: boolean): Promise<AdminUser> => {
    const res = await api.put<ApiResponse<AdminUser>>(`/api/admin/admins/${id}/status`, { isActive });
    return res.data.data;
  },
  
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/admin/admins/${id}`);
  },

  resetPassword: async (id: string, newPassword?: string): Promise<{ tempPassword: string }> => {
    const res = await api.post<ApiResponse<{ tempPassword: string }>>(`/api/admin/admins/${id}/reset-password`, { newPassword });
    return res.data.data;
  }
};
