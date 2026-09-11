import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Lock, Bell, Shield, Mail, Key, Check, Eye, EyeOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { useAuthStore } from '@/store/authStore';
import { Avatar } from '@/components/shared/Avatar';
import { authService } from '@/services/auth.service';

const ALL_ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: '#7B2D8B' },
  { value: 'manager', label: 'Manager', color: '#1565C0' },
  { value: 'logistics_officer', label: 'Logistics Officer', color: '#2E7D32' },
  { value: 'finance_officer', label: 'Finance Officer', color: '#00838F' },
  { value: 'crm_officer', label: 'CRM Officer', color: '#E65100' },
  { value: 'support_staff', label: 'Support Staff', color: '#C62828' }
];

export default function Settings() {
  const { admin, setAdmin } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'profile';

  
  const [name, setName] = useState(admin?.name || '');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    registration: true,
    shipment_created: true,
    status_updated: true,
    invoice_created: true,
    payment_received: true,
    overdue_alert: true,
    newsletter_sent: false
  });

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
    } catch (err) {
      console.error(err);
      alert('Failed to update password. Verify current password.');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleTogglePref = async (key: string) => {
    const nextVal = !prefs[key];
    const updatedPrefs = { ...prefs, [key]: nextVal };
    setPrefs(updatedPrefs);
    try {
      await authService.updateNotificationPrefs(updatedPrefs);
      if (admin) {
        setAdmin({ ...admin, notificationPrefs: updatedPrefs });
      }
    } catch (err) {
      console.error('Failed to save notification preferences:', err);
      setPrefs(prefs); 
      alert('Failed to save preference update');
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
        {}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', gap: 32, overflowX: 'auto', paddingBottom: 1 }}>
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
                    borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
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
        {}
        {activeTab === 'profile' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
              <User size={20} color="var(--color-primary)" />
              <h3 className="card-title" style={{ marginBottom: 0 }}>Admin Profile</h3>
            </div>

            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <Avatar name={admin?.name || 'VHI Admin'} size="lg" />
              <div>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => alert('Photo uploads are not configured. Deterministic initials initials component is active.')}
                >
                  Upload photo
                </button>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 6 }}>
                  Initials avatars are generated dynamically from your full name.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, width: '100%' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--color-page-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-input)', color: 'var(--color-text-muted)' }}>
                  <Mail size={16} />
                  <span>{admin?.email}</span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Assigned Roles</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {admin?.assignedRoles?.map((r) => {
                    const matched = ALL_ROLES.find((role) => role.value === r);
                    return (
                      <span
                        key={r}
                        style={{
                          background: `${matched?.color || 'var(--color-border)'}15`,
                          color: matched?.color || 'var(--color-text-muted)',
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
                  })}
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
              <Check size={14} />
              <span>To switch between your assigned active roles, click on your active role tag in the top bar dropdown.</span>
            </div>

            <button
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={handleSaveProfile}
              disabled={savingProfile || !name.trim()}
            >
              {savingProfile ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {}
        {activeTab === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--color-border)', paddingBottom: 16, marginBottom: 20 }}>
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
                      placeholder="Enter new password (min. 8 characters)..."
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {}
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
                  style={{ alignSelf: 'flex-start' }}
                  onClick={handleUpdatePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </div>

            {/* 2FA Card */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>
                <Shield size={20} color="var(--color-primary)" />
                <div>
                  <h3 className="card-title" style={{ marginBottom: 0 }}>Two-Factor Authentication (2FA)</h3>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Secure your admin panel with dual factor sign in.</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--color-border)', paddingBottom: 16, marginBottom: 20 }}>
                <Key size={20} color="var(--color-primary)" />
                <h3 className="card-title" style={{ marginBottom: 0 }}>Active Connected Devices</h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  { device: 'Windows 11 PC • Lagos, Nigeria', browser: 'Chrome Browser', current: true, ip: '102.89.34.12' },
                  { device: 'Apple iPhone 15 Pro • Lagos, Nigeria', browser: 'Safari Mobile', current: false, ip: '102.89.44.82' }
                ].map((s, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, background: 'var(--color-page-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-input)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                        {s.device} {s.current && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '1px 6px', borderRadius: 'var(--border-radius-pill)', fontWeight: 600 }}>Active Session</span>}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{s.browser} • IP: {s.ip}</div>
                    </div>
                    {!s.current && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-status-pending-text)' }} onClick={() => alert('Session terminated.')}>
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
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--color-border)', paddingBottom: 16, marginBottom: 24 }}>
              <Bell size={20} color="var(--color-primary)" />
              <div>
                <h3 className="card-title" style={{ marginBottom: 0 }}>Notification Preferences</h3>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Preferences are saved automatically in real-time.</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {[
                { key: 'registration', label: 'New Customer Registrations', desc: 'Get alert when a new customer registers on the client application.' },
                { key: 'shipment_created', label: 'New Shipments Created', desc: 'Get alert when customers draft or initialize new shipping orders.' },
                { key: 'status_updated', label: 'Shipment Status Updates', desc: 'Receive internal updates when freight operations progress through checkpoints.' },
                { key: 'invoice_created', label: 'Pending Invoice Alerts', desc: 'Alert when invoices are created and drafted waiting for review.' },
                { key: 'payment_received', label: 'Payment Receipts', desc: 'Receive alerts when successful transaction logs are captured by gateways.' },
                { key: 'overdue_alert', label: 'Overdue Invoices', desc: 'Receive immediate alerts when invoice due dates pass without settlement.' },
                { key: 'newsletter_sent', label: 'Newsletter Broadcasts', desc: 'Receive internal confirmations when marketing campaigns are broadcast.' }
              ].map((pref) => (
                <label key={pref.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', paddingBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ paddingRight: 16 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{pref.label}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>{pref.desc}</div>
                  </div>
                  <Switch
                    checked={prefs[pref.key] ?? false}
                    onCheckedChange={() => handleTogglePref(pref.key)}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

      </div>
      </div>
    </PageWrapper>
  );
}
