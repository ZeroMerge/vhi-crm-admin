import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, ChevronDown, User, Settings, LogOut, Menu, Crown, Truck, Users, Headset, Trophy, Medal } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';
import { authService } from '@/services/auth.service';
import { Avatar } from '@/components/shared/Avatar';
import { formatShortDate } from '@/utils/formatDate';
import type { AdminRole } from '@/types';
import api from '@/services/api';
import { useUIStore } from '@/store/uiStore';

// Map roles to human-readable labels
const roleLabels: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  manager: 'Manager',
  logistics_officer: 'Logistics Officer',
  finance_officer: 'Finance Officer',
  crm_officer: 'CRM Officer',
  support_staff: 'Support Staff',
};

export function Topbar() {
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const logout = useAuthStore((s) => s.logout);
  const { notifications, unreadCount, markAllAsRead, markAsRead } = useNotificationStore();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // Search states
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    customers: any[];
    shipments: any[];
    invoices: any[];
  } | null>(null);

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) {
        setShowNotifications(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setShowProfile(false);
      }
      if (searchRef.current && !searchRef.current.contains(target)) {
        setSearchExpanded(false);
        setSearchResults(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Collapse search on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchExpanded(false);
        setSearchResults(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 300ms Debounced Global Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await api.get(`/api/admin/search?q=${searchQuery}`);
        setSearchResults(res.data.data);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSignOut = async () => {
    try {
      await authService.logout();
    } catch (err) {
      console.error(err);
    } finally {
      logout();
      navigate('/admin/login');
    }
  };

  const handleDropdownNavigate = (path: string) => {
    setShowProfile(false);
    navigate(path);
  };

  const today = formatShortDate(new Date().toISOString());

  const badgeConfig = (() => {
    switch (admin?.activeRole) {
      case 'super_admin': return { bg: '#d49a15', icon: (s: number) => <Crown size={s} strokeWidth={2.5} /> };
      case 'manager': return { bg: '#7c7d7e', icon: (s: number) => <Trophy size={s} strokeWidth={2.5} /> };
      case 'finance_officer': return { bg: '#af5547', icon: (s: number) => <Medal size={s} strokeWidth={2.5} /> };
      case 'logistics_officer': return { bg: '#3b82f6', icon: (s: number) => <Truck size={s} strokeWidth={2.5} /> };
      case 'crm_officer': return { bg: '#22c55e', icon: (s: number) => <Users size={s} strokeWidth={2.5} /> };
      default: return { bg: '#64748b', icon: (s: number) => <Headset size={s} strokeWidth={2.5} /> };
    }
  })();

  return (
    <header className="topbar">
      {/* Left - Hamburger (Mobile) + Date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button 
          className="topbar-hamburger" 
          onClick={toggleSidebar}
          aria-label="Toggle Navigation Sidebar"
        >
          <Menu size={24} />
        </button>
        <div className="topbar-title" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          Today - {today}
        </div>
      </div>

      {/* Right - Actions */}
      <div className="topbar-right">
        
        {/* Sliding Inline Search */}
        <div ref={searchRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: searchExpanded ? 320 : 0,
              opacity: searchExpanded ? 1 : 0,
              overflow: 'hidden',
              transition: 'width 0.25s ease, opacity 0.25s ease',
              marginRight: searchExpanded ? 8 : 0,
            }}
          >
            <input
              type="text"
              className="input"
              placeholder="Search customers, shipments, invoices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                borderRadius: '9999px',
                paddingLeft: '16px',
                height: '40px',
                fontSize: 'var(--font-size-sm)',
              }}
            />
          </div>
          <button
            onClick={() => setSearchExpanded(!searchExpanded)}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              transition: 'all 0.15s ease',
            }}
          >
            <Search size={20} />
          </button>

          {/* Grouped Search Results Dropdown */}
          {searchExpanded && searchResults && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 380,
                background: 'var(--color-page-bg)',
                borderRadius: 'var(--border-radius-card)',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--color-border)',
                zIndex: 1000,
                maxHeight: '480px',
                overflowY: 'auto',
                padding: '8px 0',
              }}
            >
              {searchLoading && (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  Searching...
                </div>
              )}

              {!searchLoading &&
                searchResults.customers.length === 0 &&
                searchResults.shipments.length === 0 &&
                searchResults.invoices.length === 0 && (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    No results found
                  </div>
                )}

              {!searchLoading && (
                <>
                  {/* Customers Group */}
                  {searchResults.customers.length > 0 && (
                    <div>
                      <div style={{ padding: '8px 16px 4px', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Customers
                      </div>
                      {searchResults.customers.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => { navigate(`/admin/customers/${c.id}`); setSearchExpanded(false); }}
                          style={{ padding: '8px 16px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', transition: 'background 0.1s ease' }}
                          className="dropdown-item"
                        >
                          <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{c.firstname} {c.lastname}</div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{c.email} • {c.user_id}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Shipments Group */}
                  {searchResults.shipments.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ padding: '8px 16px 4px', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Shipments
                      </div>
                      {searchResults.shipments.map((s) => (
                        <div
                          key={s.id}
                          onClick={() => { navigate(`/admin/shipments/${s.id}`); setSearchExpanded(false); }}
                          style={{ padding: '8px 16px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', transition: 'background 0.1s ease' }}
                          className="dropdown-item"
                        >
                          <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{s.order_id}</div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{s.nature_of_item} • {s.status}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Invoices Group */}
                  {searchResults.invoices.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ padding: '8px 16px 4px', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Invoices
                      </div>
                      {searchResults.invoices.map((i) => (
                        <div
                          key={i.id}
                          onClick={() => { navigate(`/admin/invoices/${i.id}`); setSearchExpanded(false); }}
                          style={{ padding: '8px 16px', cursor: 'pointer', fontSize: 'var(--font-size-sm)', transition: 'background 0.1s ease' }}
                          className="dropdown-item"
                        >
                          <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{i.invoice_number}</div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{i.amount} {i.currency} • {i.status}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div ref={notifRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              position: 'relative',
              transition: 'all 0.15s ease',
            }}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: 'var(--color-accent-pink)',
                  color: 'white',
                  fontSize: 10,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid var(--color-page-bg)',
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="topbar-notifications-dropdown">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Notifications</span>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary)',
                      fontSize: 'var(--font-size-xs)',
                      cursor: 'pointer',
                    }}
                  >
                    Mark all as read
                  </button>
                )}
              </div>
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                    No notifications
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => markAsRead(n.id)}
                      style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        background: n.read ? 'var(--color-page-bg)' : 'var(--color-primary-light)',
                        borderLeft: n.read ? 'none' : '3px solid var(--color-primary)',
                      }}
                    >
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)', marginBottom: 4 }}>
                        {n.title}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                        {n.message}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile Dropdown */}
        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowProfile(!showProfile)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '50%',
              transition: 'background 0.2s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <div style={{ position: 'relative' }}>
              <Avatar name={admin?.name || 'VHI Admin'} size="md" />
              <div
                style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -4,
                  background: badgeConfig.bg,
                  color: 'white',
                  borderRadius: '6px',
                  width: 20,
                  height: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid var(--color-page-bg)',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                {badgeConfig.icon(10)}
              </div>
            </div>
            <ChevronDown
              size={14}
              color="var(--color-text-muted)"
              style={{
                transition: 'transform 0.2s ease',
                transform: showProfile ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            />
          </button>

          {showProfile && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 8px)',
                width: 240,
                background: 'var(--color-page-bg)',
                borderRadius: 'var(--border-radius-card)',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--color-border)',
                zIndex: 1000,
                overflow: 'hidden',
              }}
            >
              {/* Dropdown Header with Name and Role */}
              <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={admin?.name || 'VHI Admin'} size="lg" />
                <div>
                  <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {admin?.name || 'VHI Admin'}
                  </div>
                  <div style={{
                    marginTop: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}>
                    {/* Replacing the text completely with the beautiful badge as requested */}
                    <div style={{
                      background: badgeConfig.bg,
                      color: 'white',
                      borderRadius: '6px',
                      width: 26,
                      height: 26,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid var(--color-page-bg)',
                      boxShadow: 'var(--shadow-sm)'
                    }}>
                      {badgeConfig.icon(14)}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ padding: '8px' }}>
                <button
                  onClick={() => handleDropdownNavigate('/admin/settings?tab=profile')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    width: '100%',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                    textAlign: 'left',
                    borderRadius: '6px',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hover, #f3f4f6)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <User size={16} />
                  My Profile
                </button>
                <button
                  onClick={() => handleDropdownNavigate('/admin/settings?tab=account')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    width: '100%',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-secondary)',
                    textAlign: 'left',
                    borderRadius: '6px',
                    transition: 'background 0.15s ease',
                    marginTop: '2px',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface-hover, #f3f4f6)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <Settings size={16} />
                  Account Settings
                </button>
              </div>
              
              <div style={{ height: 1, background: 'var(--color-border)', margin: '0' }} />
              
              {/* Role Switcher for Testing */}
              <div style={{ padding: '12px 16px 4px', fontSize: '10px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.05em' }}>Switch Role (Test)</div>
              <div style={{ padding: '4px 8px' }}>
                {Object.keys(roleLabels).map((role) => (
                  <button
                    key={role}
                    onClick={() => {
                      const state = useAuthStore.getState();
                      if (state.admin) {
                        state.setAdmin({ ...state.admin, activeRole: role as AdminRole });
                      }
                      setShowProfile(false);
                      // Reload to reset state depending on role
                      window.location.href = '/admin';
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      width: '100%',
                      border: 'none',
                      background: admin?.activeRole === role ? 'var(--color-primary-light)' : 'none',
                      cursor: 'pointer',
                      fontSize: 'var(--font-size-sm)',
                      color: admin?.activeRole === role ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      fontWeight: admin?.activeRole === role ? 600 : 400,
                      textAlign: 'left',
                      borderRadius: '6px',
                      transition: 'background 0.15s ease',
                      marginTop: '2px',
                    }}
                    onMouseEnter={(e) => { if (admin?.activeRole !== role) e.currentTarget.style.backgroundColor = 'var(--color-surface-hover, #f3f4f6)'; }}
                    onMouseLeave={(e) => { if (admin?.activeRole !== role) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    {roleLabels[role as AdminRole]}
                  </button>
                ))}
              </div>

              <div style={{ height: 1, background: 'var(--color-border)', margin: '0' }} />
              
              <div style={{ padding: '8px' }}>
                <button
                  onClick={handleSignOut}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    width: '100%',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 500,
                    color: '#D32F2F', /* Sign out is red */
                    textAlign: 'left',
                    borderRadius: '6px',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#FFF5F5';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <LogOut size={16} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
