import { create } from 'zustand';
import type { Admin } from '@/types';

interface AuthState {
  admin: Admin | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAdmin: (admin: Admin) => void;
  setToken: (token: string) => void;
  setAuth: (admin: Admin, token: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

const safeParseAdmin = (): Admin | null => {
  try {
    const saved = localStorage.getItem('admin_user');
    return saved ? JSON.parse(saved) : null;
  } catch (err) {
    console.error('Failed to parse admin_user from localStorage:', err);
    return null;
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  admin: safeParseAdmin(),
  token: localStorage.getItem('admin_token'),
  isAuthenticated: !!localStorage.getItem('admin_token'),
  isLoading: false,
  setAdmin: (admin) => {
    localStorage.setItem('admin_user', JSON.stringify(admin));
    set({ admin });
  },
  setToken: (token) => {
    localStorage.setItem('admin_token', token);
    set({ token });
  },
  setAuth: (admin, token) => {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_user', JSON.stringify(admin));
    set({ admin, token, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    set({ admin: null, token: null, isAuthenticated: false });
  },
  setLoading: (loading) => set({ isLoading: loading }),
}));
