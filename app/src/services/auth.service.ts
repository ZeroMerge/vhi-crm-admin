import api from './api';
import type { ApiResponse, Admin, AdminRole } from '@/types';

interface LoginData {
  email: string;
  password: string;
  selectedRole?: AdminRole;
}

export interface NotificationPrefsResponse {
  prefs: Record<string, boolean>;
  /** Keys that currently send email (the others are saved for later). */
  emailKeys: string[];
}

interface LoginResponse {
  token?: string;
  admin?: Admin;
  requiresRoleSelection?: boolean;
  assignedRoles?: AdminRole[];
}

/** Why an invitation can't be used: unknown/used/revoked, expired, rate-limited, or the password was refused. */
export type InviteErrorCode = 'invalid' | 'expired' | 'password' | 'rate_limited' | 'network';

export class InviteError extends Error {
  readonly code: InviteErrorCode;
  constructor(code: InviteErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function toInviteError(err: any): InviteError {
  const status = err?.response?.status;
  const data = err?.response?.data;
  if (status === 410) return new InviteError('expired', data?.message || 'This invitation has expired.');
  if (status === 429) return new InviteError('rate_limited', 'Too many attempts. Wait a minute and try again.');
  if (status === 400 && data?.code === 'password') return new InviteError('password', data.message);
  if (status === 400) return new InviteError('invalid', data?.message || 'This invitation link is invalid or has already been used.');
  return new InviteError('network', 'Something went wrong. Check your connection and try again.');
}

export const authService = {
  // Public invitation endpoints (Phase 4). The token only ever travels in the POST body.
  inspectInvite: async (token: string): Promise<{ email: string; name: string | null }> => {
    try {
      const res = await api.post<ApiResponse<{ email: string; name: string | null }>>('/api/auth/admin/invite/inspect', { token });
      return res.data.data;
    } catch (err) {
      throw toInviteError(err);
    }
  },

  acceptInvite: async (data: { token: string; password: string; confirmPassword: string }): Promise<{ email: string }> => {
    try {
      const res = await api.post<ApiResponse<{ email: string }>>('/api/auth/admin/accept-invite', data);
      return res.data.data;
    } catch (err) {
      throw toInviteError(err);
    }
  },

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

  // Saved email preferences (normalised by the server) and the keys that currently send email.
  getNotificationPrefs: async (): Promise<NotificationPrefsResponse> => {
    const res = await api.get<ApiResponse<NotificationPrefsResponse>>('/api/auth/admin/notification-preferences');
    return res.data.data;
  },

  // Partial update: only the keys given change; the server merges and returns the saved preferences.
  updateNotificationPrefs: async (notificationPrefs: Record<string, boolean>): Promise<NotificationPrefsResponse> => {
    const res = await api.put<ApiResponse<NotificationPrefsResponse>>('/api/auth/admin/notification-preferences', { notificationPrefs });
    return res.data.data;
  },
};
export default authService;
