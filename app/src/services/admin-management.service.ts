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
  /** Invited but has not set a password yet (Phase 4). */
  invitePending?: boolean;
}

export const adminManagementService = {
  list: async (): Promise<AdminUser[]> => {
    const res = await api.get<ApiResponse<AdminUser[]>>('/api/admin/admins');
    return res.data.data;
  },
  
  // Sends an invitation email with a single-use link (72 h). No password or link comes back.
  invite: async (data: { name: string; email: string; assignedRoles: string[] }): Promise<{ admin: AdminUser; invitePending: boolean }> => {
    const res = await api.post<ApiResponse<{ admin: AdminUser; invitePending: boolean }>>('/api/admin/admins/invite', data);
    return res.data.data;
  },

  // New link by email; the previous one stops working. 409 when already accepted or the admin is deactivated.
  resendInvite: async (id: string): Promise<{ message: string }> => {
    const res = await api.post<{ success: boolean; message: string }>(`/api/admin/admins/${id}/resend-invite`);
    return { message: res.data.message };
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
