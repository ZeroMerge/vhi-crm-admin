import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  FilePlus,
  ClipboardCheck,
  CheckCircle,
  Receipt,
  Mail,
  Newspaper,
  MessageSquare,
  Settings,
  LogOut,
  BarChart2,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { hasModuleAccess } from '@/utils/rolePermissions';
import { useUIStore } from '@/store/uiStore';

import logoImg from '@/components/public/logo.png';
import iconImg from '@/components/public/icon.png';

const primaryNav = [
  { label: 'Overview', icon: LayoutGrid, path: '/admin', module: 'overview' },
  { label: 'Customers', icon: FilePlus, path: '/admin/customers', module: 'customers' },
  { label: 'Shipments', icon: ClipboardCheck, path: '/admin/shipments', module: 'shipments' },
  { label: 'Tracking', icon: CheckCircle, path: '/admin/tracking', module: 'tracking' },
  { label: 'Invoices', icon: Receipt, path: '/admin/invoices', module: 'invoices' },
  { label: 'Communications', icon: Mail, path: '/admin/communications', module: 'communications' },
  { label: 'Newsletter', icon: Newspaper, path: '/admin/newsletter', module: 'newsletter' },
];

const secondaryNav = [
  { label: 'Reports', icon: BarChart2, path: '/admin/reports', module: 'reports' },
  { label: 'Feedback', icon: MessageSquare, path: '/admin/feedback', module: 'reports' },
  { label: 'Settings', icon: Settings, path: '/admin/settings', module: 'settings' },
];

export function AdminSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const admin = useAuthStore((s) => s.admin);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  const isActive = (path: string) => {
    if (path === '/admin') return location.pathname === '/admin';
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const activeRole = admin?.activeRole;

  // Filter navigation items by active role permissions
  const filteredPrimary = primaryNav.filter((item) => hasModuleAccess(activeRole, item.module));
  const filteredSecondary = secondaryNav.filter((item) => hasModuleAccess(activeRole, item.module));

  return (
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      {/* Logo */}
      <div
        className="sidebar-logo-container"
        style={{
          padding: '24px 16px 20px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexShrink: 0,
          width: '100%',
        }}
      >
        <img
          src={logoImg}
          className="sidebar-logo-full"
          alt="ValueHandlers Logo"
          style={{
            height: '40px',
            maxWidth: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
        <img
          src={iconImg}
          className="sidebar-logo-collapsed"
          alt="ValueHandlers Icon"
          style={{
            height: '36px',
            maxWidth: '100%',
            objectFit: 'contain',
            display: 'none',
          }}
        />
      </div>

      {/* Primary Navigation */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 12px', overflowY: 'auto' }}>
        {filteredPrimary.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              data-tooltip={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                borderRadius: 'var(--radius-button)', /* 8px */
                background: active ? 'var(--color-primary)' : 'transparent',
                color: active ? 'white' : 'var(--color-text-secondary)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-family)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: active ? 500 : 400,
                transition: 'all 0.15s ease',
                margin: '0 0 2px',
                textAlign: 'left',
                width: '100%',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--color-primary-light)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }
              }}
            >
              <Icon size={20} style={{ flexShrink: 0 }} />
              <span className="nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Secondary Navigation */}
      <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        {filteredSecondary.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              data-tooltip={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                borderRadius: 'var(--radius-button)', /* 8px */
                background: active ? 'var(--color-primary)' : 'transparent',
                color: active ? 'white' : 'var(--color-text-secondary)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-family)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: active ? 500 : 400,
                transition: 'all 0.15s ease',
                textAlign: 'left',
                width: '100%',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--color-primary-light)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }
              }}
            >
              <Icon size={20} style={{ flexShrink: 0 }} />
              <span className="nav-label">{item.label}</span>
            </button>
          );
        })}

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--color-border)', margin: '8px 16px' }} />

        {/* Log Out */}
        <button
          onClick={handleLogout}
          data-tooltip="Log Out"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            borderRadius: 'var(--radius-button)', /* 8px */
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-family)',
            fontSize: 'var(--font-size-sm)',
            transition: 'all 0.15s ease',
            textAlign: 'left',
            width: '100%',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--color-status-pending-bg)';
            e.currentTarget.style.color = 'var(--color-status-pending-text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
        >
          <LogOut size={20} style={{ flexShrink: 0 }} />
          <span className="nav-label">Log Out</span>
        </button>
      </div>
    </aside>
  );
}
