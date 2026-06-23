import api from './api';
import type { ApiResponse, Admin, AdminRole } from '@/types';

interface LoginData {
  email: string;
  password: string;
  selectedRole?: AdminRole;
}

interface LoginResponse {
  token?: string;
  admin?: Admin;
  requiresRoleSelection?: boolean;
  assignedRoles?: AdminRole[];
}

export const authService = {
  verifyEmail: async (email: string): Promise<boolean> => {
    try {
      const res = await api.post<ApiResponse<null>>('/api/auth/admin/verify-email', { email });
      return res.data.success;
    } catch (err: any) {
      if (err.response?.data?.message) {
        throw new Error(err.response.data.message);
      }
      throw err;
    }
  },

  login: async (data: LoginData): Promise<LoginResponse> => {
    const res = await api.post<ApiResponse<LoginResponse>>('/api/auth/admin/login', data);
    return res.data.data;
  },
  
  logout: async (): Promise<void> => {
    try {
      await api.post('/api/auth/admin/logout');
    } catch (err) {
      console.error('Logout API failed:', err);
    }
  },
  
  switchRole: async (role: AdminRole): Promise<LoginResponse> => {
    const res = await api.post<ApiResponse<LoginResponse>>('/api/auth/admin/switch-role', { role });
    return res.data.data;
  },
  
  getMe: async (): Promise<Admin> => {
    const res = await api.get<ApiResponse<Admin>>('/api/auth/admin/me');
    return res.data.data;
  },
  
  changePassword: async (data: { currentPassword: string; newPassword: string }): Promise<void> => {
    await api.put('/api/auth/admin/change-password', data);
  },

  updateProfile: async (data: { name: string; phone?: string }): Promise<void> => {
    await api.put('/api/auth/admin/profile', data);
  },

  updateNotificationPrefs: async (notificationPrefs: any): Promise<void> => {
    await api.put('/api/auth/admin/notification-preferences', { notificationPrefs });
  },
};
export default authService;
