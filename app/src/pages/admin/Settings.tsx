import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Lock, Bell, Shield, Mail, Key, Check, Eye, EyeOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { useAuthStore } from '@/store/authStore';
import { Avatar } from '@/components/shared/Avatar';
import { authService } from '@/services/auth.service';
import { useIsMobile } from '@/hooks/use-mobile';

const ALL_ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: '#7B2D8B' },
  { value: 'manager', label: 'Manager', color: '#1565C0' },
  { value: 'logistics_officer', label: 'Logistics Officer', color: '#2E7D32' },
  { value: 'finance_officer', label: 'Finance Officer', color: '#00838F' },
  { value: 'crm_officer', label: 'CRM Officer', color: '#E65100' },
  { value: 'support_staff', label: 'Support Staff', color: '#C62828' }
];

// Optional emails; all default on (the server's defaults). Times are in the business time zone (WAT).
const EMAIL_PREFS: Array<{ key: string; label: string; description: string; roles: string[] }> = [
  {
    key: 'shipment_created',
    label: 'Email me about new shipments',
    description: 'An email each time a customer creates a shipment in the customer portal.',
    roles: ['super_admin', 'manager', 'logistics_officer'],
  },
  {
    key: 'registration',
    label: 'Daily email: new customer registrations',
    description: "At 08:00, a list of the customers who verified their accounts the day before. Nothing is sent when there are none.",
    roles: ['super_admin', 'manager', 'crm_officer'],
  },
  {
    key: 'overdue_alert',
    label: 'Email me when invoices become overdue',
    description: 'At 07:00, one email listing the invoices that became overdue that day.',
    roles: ['super_admin', 'manager', 'finance_officer'],
  },
];

export default function Settings() {
  const { admin, setAdmin } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'profile';
  const isMobile = useIsMobile();

  
  const [name, setName] = useState(admin?.name || '');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  
  // Email preferences, loaded from the server when the Notifications tab opens (null = not loaded yet).
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [savingPref, setSavingPref] = useState<string | null>(null);
  // Email preferences that send something, each shown only to the roles that receive it (backend recipients:
  // shipment_created → SHIPMENT_OPERATIONS_ROLES, registration → CUSTOMER_GROWTH_ROLES in modules/notifications/events.ts,
  // overdue_alert → roles with the invoices module in middleware/permissions.ts).
  const myRoles = admin?.assignedRoles ?? [];
  const emailPrefs = EMAIL_PREFS.filter((p) => myRoles.some((r) => p.roles.includes(r)));

  useEffect(() => {
    if (activeTab !== 'notifications') return;
    let active = true;
    setPrefsError(null);
    authService
      .getNotificationPrefs()
      .then((res) => {
        if (active) setPrefs(res.prefs);
      })
      .catch((err) => {
        console.error('Failed to load notification preferences:', err);
        if (active) setPrefsError('Could not load your notification settings. Please refresh the page.');
      });
    return () => {
      active = false;
    };
  }, [activeTab]);

  const setActiveTab = (tabId: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tabId);
    setSearchParams(newParams);
  };

  const handleSaveProfile = async () => {
    if (!name.trim()) return;
    setSavingProfile(true);
    try {
      await authService.updateProfile({ name, phone });
      const freshAdmin = await authService.getMe();
      setAdmin(freshAdmin);
      alert('Profile updated successfully.');
    } catch (err) {
      console.error(err);
      alert('Error updating profile. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      alert('All password fields are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('New passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await authService.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      alert('Password changed successfully.');
    } catch (err: any) {
      console.error(err);
      // The server explains a refused password (wrong current password, or the rule: 8–72 characters, not your email).
      alert(err.response?.data?.message || 'Failed to update password. Verify current password.');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleTogglePref = async (key: string) => {
    if (!prefs || savingPref) return;
    const previous = prefs;
    const nextVal = !prefs[key];
    setPrefs({ ...prefs, [key]: nextVal });
    setSavingPref(key);
    try {
      // Send only the changed key; the server merges it into the saved preferences.
      const saved = await authService.updateNotificationPrefs({ [key]: nextVal });
      setPrefs(saved.prefs);
      if (admin) {
        setAdmin({ ...admin, notificationPrefs: saved.prefs });
      }
    } catch (err) {
      console.error('Failed to save notification preferences:', err);
      setPrefs(previous);
      alert('Failed to save preference update');
    } finally {
      setSavingPref(null);
    }
  };

  
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { label: '', color: 'transparent', width: '0%' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 1) return { label: 'Weak', color: 'var(--color-status-cancelled-text)', width: '25%' };
    if (score === 2) return { label: 'Medium', color: '#E65100', width: '50%' };
    if (score === 3) return { label: 'Strong', color: 'var(--color-primary)', width: '75%' };
    return { label: 'Excellent', color: '#2E7D32', width: '100%' };
  };

  const pStrength = getPasswordStrength(newPassword);

  const tabsConfig = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'account', label: 'Account Settings', icon: Lock },
    { id: 'notifications', label: 'Notifications', icon: Bell }
  ];

  return (
    <PageWrapper title="Settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Tab navigation */}
        <div style={{ display: 'flex', borderBottom: '1.5px solid var(--color-border)', gap: isMobile ? 16 : 32, overflowX: 'auto', paddingBottom: 1, WebkitOverflowScrolling: 'touch' }}>
          {tabsConfig.map((t) => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '0 0 12px 0',
                    background: 'transparent',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 'var(--font-size-sm)',
                    border: 'none',
                    borderBottom: isActive ? '2.5px solid var(--color-primary)' : '2.5px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                    marginBottom: '-1px'
                  }}
                >
                  <t.icon size={16} />
                  {t.label}
                </button>
              );
            })}
        </div>

      <div style={{ width: '100%', maxWidth: 880 }}>
        {/* Tab 1: Profile */}
        {activeTab === 'profile' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: isMobile ? 16 : 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1.5px solid var(--color-border)', paddingBottom: 16 }}>
              <User size={20} color="var(--color-primary)" />
              <h3 className="card-title" style={{ marginBottom: 0 }}>Admin Profile</h3>
            </div>

            <div style={{ display: 'flex', gap: isMobile ? 16 : 24, alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row' }}>
              <Avatar name={admin?.name || 'VHI Admin'} size="lg" />
              <div>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => alert('Photo uploads are not configured. Deterministic initials component is active.')}
                >
                  Upload photo
                </button>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 6 }}>
                  Initials avatars are generated dynamically from your full name.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 16 : 20, width: '100%' }}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name..."
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number (Optional)</label>
                <input
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +234 801 234 5678"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address (Read-only)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--color-page-bg)', border: '1.5px solid var(--color-border)', borderRadius: 'var(--border-radius-input)', color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>
                  <Mail size={16} style={{ flexShrink: 0 }} />
                  <span>{admin?.email}</span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Assigned Roles</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {admin?.assignedRoles && admin.assignedRoles.length > 0 ? (
                    admin.assignedRoles.map((r) => {
                      const matched = ALL_ROLES.find((role) => role.value === r);
                      const isSuper = r === 'super_admin';
                      return (
                        <span
                          key={r}
                          style={{
                            background: isSuper ? 'var(--color-primary-light)' : `${matched?.color || 'var(--color-border)'}18`,
                            color: isSuper ? 'var(--color-primary)' : (matched?.color || 'var(--color-text-muted)'),
                            border: isSuper ? '1.5px solid var(--color-primary)' : '1.5px solid transparent',
                            padding: '4px 10px',
                            borderRadius: 'var(--border-radius-pill)',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 600,
                            textTransform: 'capitalize'
                          }}
                        >
                          {r.replace(/_/g, ' ')}
                        </span>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>No roles assigned</span>
                  )}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--color-primary-light)',
                padding: '10px 16px',
                borderRadius: 'var(--border-radius-input)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-primary)',
                fontWeight: 500
              }}
            >
              <Check size={14} style={{ flexShrink: 0 }} />
              <span>To switch between your assigned active roles, click on your active role tag in the top bar dropdown.</span>
            </div>

            <button
              className="btn btn-primary"
              style={{ alignSelf: isMobile ? 'stretch' : 'flex-start', width: isMobile ? '100%' : 'auto' }}
              onClick={handleSaveProfile}
              disabled={savingProfile || !name.trim()}
            >
              {savingProfile ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* Tab 2: Account Settings */}
        {activeTab === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Change Password */}
            <div className="card" style={{ padding: isMobile ? 16 : 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1.5px solid var(--color-border)', paddingBottom: 16, marginBottom: 20 }}>
                <Lock size={20} color="var(--color-primary)" />
                <h3 className="card-title" style={{ marginBottom: 0 }}>Change Password</h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Current Password</label>
                  <input
                    className="input"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password..."
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
                  <label className="form-label">New Password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="8–72 characters, not your email"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {/* Password Strength Meter */}
                  {newPassword && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', marginBottom: 4 }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>Strength Complexity:</span>
                        <span style={{ fontWeight: 600, color: pStrength.color }}>{pStrength.label}</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 'var(--border-radius-pill)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: pStrength.color, width: pStrength.width, transition: 'width 0.3s ease' }} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Confirm New Password</label>
                  <input
                    className="input"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password..."
                  />
                </div>

                <button
                  className="btn btn-primary"
                  style={{ alignSelf: isMobile ? 'stretch' : 'flex-start', width: isMobile ? '100%' : 'auto' }}
                  onClick={handleUpdatePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </div>

            {/* 2FA Card */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: isMobile ? 16 : 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1.5px solid var(--color-border)', paddingBottom: 16 }}>
                <Shield size={20} color="var(--color-primary)" />
                <div>
                  <h3 className="card-title" style={{ marginBottom: 0 }}>Two-Factor Authentication (2FA)</h3>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Secure your admin panel with dual factor sign in.</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>SMS/Email Verification Codes</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Verification challenges will be prompted during login.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', background: 'var(--color-border)', padding: '2px 8px', borderRadius: 'var(--border-radius-pill)', fontWeight: 500 }}>Coming Soon</span>
                  <Switch disabled checked={false} />
                </div>
              </div>
            </div>

            {/* Active Sessions */}
            <div className="card" style={{ padding: isMobile ? 16 : 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1.5px solid var(--color-border)', paddingBottom: 16, marginBottom: 20 }}>
                <Key size={20} color="var(--color-primary)" />
                <h3 className="card-title" style={{ marginBottom: 0 }}>Active Connected Devices</h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  { device: 'Windows 11 PC • Lagos, Nigeria', browser: 'Chrome Browser', current: true, ip: '102.89.34.12' },
                  { device: 'Apple iPhone 15 Pro • Lagos, Nigeria', browser: 'Safari Mobile', current: false, ip: '102.89.44.82' }
                ].map((s, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: 10, padding: 12, background: 'var(--color-page-bg)', border: '1.5px solid var(--color-border)', borderRadius: 'var(--border-radius-input)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                        {s.device} {s.current && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '1px 6px', borderRadius: 'var(--border-radius-pill)', fontWeight: 600 }}>Active Session</span>}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>{s.browser} • IP: {s.ip}</div>
                    </div>
                    {!s.current && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-status-pending-text)', padding: 0 }} onClick={() => alert('Session terminated.')}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Notifications */}
        {activeTab === 'notifications' && (
          <div className="card" style={{ padding: isMobile ? 16 : 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1.5px solid var(--color-border)', paddingBottom: 16, marginBottom: 24 }}>
              <Bell size={20} color="var(--color-primary)" />
              <div>
                <h3 className="card-title" style={{ marginBottom: 0 }}>Notification Preferences</h3>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Changes are saved automatically.</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {prefsError ? (
                <div role="alert" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-status-pending-text)' }}>{prefsError}</div>
              ) : prefs === null ? (
                <div role="status" style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Loading your notification settings…</div>
              ) : emailPrefs.length > 0 ? (
                // Only email preferences that currently send something are shown (others are kept for later phases).
                emailPrefs.map((p) => (
                  <label key={p.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', paddingBottom: 16, borderBottom: '1.5px solid var(--color-border)', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{p.label}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>{p.description}</div>
                    </div>
                    <Switch
                      checked={prefs[p.key] ?? true}
                      disabled={savingPref !== null}
                      onCheckedChange={() => handleTogglePref(p.key)}
                      aria-label={p.label}
                    />
                  </label>
                ))
              ) : (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                  None of your roles receives optional notification emails yet.
                </div>
              )}
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                In-app notifications (the bell) are always on. Account emails (role changes, deactivation, password changes) are always sent.
              </div>
            </div>
          </div>
        )}

      </div>
      </div>
    </PageWrapper>
  );
}
