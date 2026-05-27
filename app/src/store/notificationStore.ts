import { create } from 'zustand';

export interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  type: 'shipment' | 'invoice' | 'tracking' | 'payment' | 'system';
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Notification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [
    {
      id: '1',
      title: 'New Shipment',
      message: 'New shipment #1895-67-fw created by John Smith',
      read: false,
      createdAt: new Date().toISOString(),
      type: 'shipment',
    },
    {
      id: '2',
      title: 'Invoice Paid',
      message: 'Invoice #INV-2024-001 marked as paid',
      read: false,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      type: 'invoice',
    },
    {
      id: '3',
      title: 'Tracking Update',
      message: 'Tracking updated for shipment #2695-77-gw',
      read: true,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      type: 'tracking',
    },
  ],
  unreadCount: 2,
  addNotification: (notification) =>
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    })),
  markAsRead: (id) =>
    set((state) => {
      const notifs = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      return {
        notifications: notifs,
        unreadCount: notifs.filter((n) => !n.read).length,
      };
    }),
  markAllAsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),
  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
      unreadCount: state.notifications.filter((n) => !n.read && n.id !== id).length,
    })),
}));
