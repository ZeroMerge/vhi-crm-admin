import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Lock, Bell, Shield, Mail, Key, Plus, Trash2, Edit, Check, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { useAuthStore } from '@/store/authStore';
import { Avatar } from '@/components/shared/Avatar';
import { authService } from '@/services/auth.service';
import { adminManagementService } from '@/services/admin-management.service';
import type { AdminUser } from '@/services/admin-management.service';

const ALL_ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: '#7B2D8B' },
  { value: 'executive', label: 'Executive', color: '#1565C0' },
  { value: 'operations_manager', label: 'Operations Manager', color: '#2E7D32' },
  { value: 'account_officer', label: 'Account Officer', color: '#00838F' },
  { value: 'sales_officer', label: 'Sales Officer', color: '#E65100' },
  { value: 'support_staff', label: 'Support Staff', color: '#C62828' }
];

export default function Settings() {
  const { admin, setAdmin } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'profile';

  const isSuperAdmin = admin?.activeRole === 'super_admin';

  // Profile Tab State
  const [name, setName] = useState(admin?.name || '');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password Tab State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Notifications Tab State
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    registration: true,
    shipment_created: true,
    status_updated: true,
    invoice_created: true,
    payment_received: true,
    overdue_alert: true,
    newsletter_sent: false
  });

  // Manage Admins Tab State
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  
  // Modals state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoles, setInviteRoles] = useState<string[]>(['support_staff']);
  const [inviting, setInviting] = useState(false);
  const [inviteSuccessData, setInviteSuccessData] = useState<{ inviteLink: string; tempPassword?: string } | null>(null);

  const [editRolesModalOpen, setEditRolesModalOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUser | null>(null);
  const [selectedAdminRoles, setSelectedAdminRoles] = useState<string[]>([]);
  const [updatingRoles, setUpdatingRoles] = useState(false);

  // Sync profile details when admin store loads
  useEffect(() => {
    if (admin) {
      setName(admin.name);
      if (admin.notificationPrefs) {
        setPrefs({
          registration: admin.notificationPrefs.registration ?? true,
          shipment_created: admin.notificationPrefs.shipment_created ?? true,
          status_updated: admin.notificationPrefs.status_updated ?? true,
          invoice_created: admin.notificationPrefs.invoice_created ?? true,
          payment_received: admin.notificationPrefs.payment_received ?? true,
          overdue_alert: admin.notificationPrefs.overdue_alert ?? true,
          newsletter_sent: admin.notificationPrefs.newsletter_sent ?? false,
        });
      }
    }
  }, [admin]);

  // Load admins list for Super Admins
  useEffect(() => {
    if (activeTab === 'admins' && isSuperAdmin) {
      let active = true;
      const fetchAdmins = async () => {
        setLoadingAdmins(true);
        try {
          const list = await adminManagementService.list();
          if (active) setAdmins(list);
        } catch (err) {
          console.error('Failed to load admins:', err);
        } finally {
          if (active) setLoadingAdmins(false);
        }
      };
      fetchAdmins();
      return () => {
        active = false;
      };
    }
  }, [activeTab, isSuperAdmin]);

  const setActiveTab = (tabId: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tabId);
    setSearchParams(newParams);
  };

  // Profile Save
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

  // Password Change
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

  // Immediate reactive notification preferences update
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
      setPrefs(prefs); // revert
      alert('Failed to save preference update');
    }
  };

  // Admin status toggle (is_active)
  const handleToggleAdminStatus = async (id: string, currentStatus: boolean) => {
    if (id === admin?.id) {
      alert('You cannot deactivate your own account.');
      return;
    }
    try {
      const updated = await adminManagementService.toggleStatus(id, !currentStatus);
      setAdmins((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: updated.is_active } : a)));
    } catch (err) {
      console.error('Failed to update admin status:', err);
      alert('Failed to toggle active status.');
    }
  };

  // Soft delete admin
  const handleDeleteAdmin = async (id: string) => {
    if (id === admin?.id) {
      alert('You cannot delete your own account.');
      return;
    }
    if (window.confirm('Are you sure you want to delete this admin account? This is a soft-delete.')) {
      try {
        await adminManagementService.delete(id);
        setAdmins((prev) => prev.filter((a) => a.id !== id));
        alert('Admin deleted successfully.');
      } catch (err) {
        console.error('Failed to delete admin:', err);
        alert('Failed to delete admin account.');
      }
    }
  };

  // Invite Admin
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim() || inviteRoles.length === 0) {
      alert('Please fill out all fields and assign at least one role.');
      return;
    }
    setInviting(true);
    try {
      const response = await adminManagementService.invite({
        name: inviteName,
        email: inviteEmail,
        assignedRoles: inviteRoles
      });
      setAdmins((prev) => [response.admin, ...prev]);
      setInviteSuccessData({
        inviteLink: response.inviteLink,
        tempPassword: response.tempPassword
      });
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.message || 'Failed to invite administrator.');
    } finally {
      setInviting(false);
    }
  };

  const closeInviteModal = () => {
    setInviteModalOpen(false);
    setInviteName('');
    setInviteEmail('');
    setInviteRoles(['support_staff']);
    setInviteSuccessData(null);
  };

  // Edit Roles
  const openEditRolesModal = (user: AdminUser) => {
    setSelectedAdmin(user);
    setSelectedAdminRoles(user.assigned_roles || []);
    setEditRolesModalOpen(true);
  };

  const handleEditRolesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmin || selectedAdminRoles.length === 0) {
      alert('Please select at least one role.');
      return;
    }
    setUpdatingRoles(true);
    try {
      const response = await adminManagementService.updateRoles(selectedAdmin.id, selectedAdminRoles);
      setAdmins((prev) => prev.map((a) => (a.id === selectedAdmin.id ? { ...a, assigned_roles: response.assigned_roles } : a)));
      setEditRolesModalOpen(false);
      setSelectedAdmin(null);
      alert('Admin roles updated successfully.');
    } catch (err) {
      console.error(err);
      alert('Failed to update roles.');
    } finally {
      setUpdatingRoles(false);
    }
  };

  // Password Strength helper
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
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'admins', label: 'Manage Admins', icon: Shield, superAdminOnly: true }
  ];

  return (
    <PageWrapper title="Settings">
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left Sidebar Nav */}
        <div className="settings-nav" style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: 8, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          {tabsConfig
            .filter((tc) => !tc.superAdminOnly || isSuperAdmin)
            .map((t) => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-button)',
                    background: isActive ? 'var(--color-page-bg)' : 'transparent',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                    border: 'none',
                    borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <t.icon size={18} />
                  {t.label}
                </button>
              );
            })}
        </div>

      <div style={{ flex: 1, minWidth: 300, maxWidth: 880 }}>
        {/* Tab 1: Profile */}
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

        {/* Tab 2: Account Settings */}
        {activeTab === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Change Password */}
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
                  {/* Realtime password complexity meter */}
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
                  <input type="checkbox" className="toggle" disabled checked={false} />
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
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={prefs[pref.key] ?? false}
                    onChange={() => handleTogglePref(pref.key)}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Manage Admins (Super Admin Only) */}
        {activeTab === 'admins' && (
          <>
            {!isSuperAdmin ? (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 40, textAlign: 'center' }}>
                <AlertTriangle size={36} color="var(--color-accent-pink)" style={{ marginBottom: 12 }} />
                <h4 style={{ fontWeight: 600 }}>Insufficient Permissions</h4>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Only logged-in Super Administrators can manage other accounts and assign role levels.
                </p>
              </div>
            ) : (
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 16, marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Shield size={20} color="var(--color-primary)" />
                    <h3 className="card-title" style={{ marginBottom: 0 }}>Manage Admins</h3>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => setInviteModalOpen(true)}>
                    <Plus size={16} />
                    Invite Admin
                  </button>
                </div>

                <div className="vhi-table-container">
                  {loadingAdmins ? (
                    <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      Loading administrator accounts...
                    </div>
                  ) : admins.length === 0 ? (
                    <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      No administrators found.
                    </div>
                  ) : (
                    <table className="vhi-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email Address</th>
                          <th>Assigned Roles</th>
                          <th>Status</th>
                          <th style={{ width: 110 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {admins.map((adm) => (
                          <tr key={adm.id}>
                            <td style={{ fontWeight: 500 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Avatar name={adm.name} size="sm" />
                                <span>{adm.name}</span>
                              </div>
                            </td>
                            <td>{adm.email}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {adm.assigned_roles?.map((role: string) => {
                                  const rMatch = ALL_ROLES.find((r) => r.value === role);
                                  return (
                                    <span
                                      key={role}
                                      style={{
                                        background: `${rMatch?.color || '#ccc'}15`,
                                        color: rMatch?.color || '#333',
                                        fontSize: 10,
                                        padding: '2px 8px',
                                        borderRadius: 'var(--border-radius-pill)',
                                        fontWeight: 600,
                                        textTransform: 'capitalize'
                                      }}
                                    >
                                      {role.replace(/_/g, ' ')}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                <input
                                  type="checkbox"
                                  className="toggle"
                                  checked={adm.is_active}
                                  disabled={adm.id === admin?.id}
                                  onChange={() => handleToggleAdminStatus(adm.id, adm.is_active)}
                                />
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-icon btn-ghost" style={{ width: 28, height: 28 }} onClick={() => openEditRolesModal(adm)}>
                                  <Edit size={14} />
                                </button>
                                <button
                                  className="btn btn-icon btn-ghost text-red"
                                  style={{ width: 28, height: 28, color: 'var(--color-status-cancelled-text)' }}
                                  disabled={adm.id === admin?.id}
                                  onClick={() => handleDeleteAdmin(adm.id)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* Invite Admin Modal */}
      {inviteModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: 480 }}>
            <button className="modal-close" onClick={closeInviteModal}>×</button>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 20 }}>Invite Administrator</h3>

            {inviteSuccessData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: '#E8F5E9', color: '#2E7D32', padding: 16, borderRadius: 'var(--border-radius-input)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                  Admin invited successfully! An invitation has been drafted.
                </div>
                <div className="form-group">
                  <label className="form-label">Local Invite Links (For Testing/Dev)</label>
                  <input className="input" readOnly value={inviteSuccessData.inviteLink} style={{ background: 'var(--color-page-bg)', fontSize: 'var(--font-size-xs)' }} />
                </div>
                {inviteSuccessData.tempPassword && (
                  <div className="form-group">
                    <label className="form-label">Temporary Password (Seed)</label>
                    <input className="input" readOnly value={inviteSuccessData.tempPassword} style={{ background: 'var(--color-page-bg)', fontSize: 'var(--font-size-xs)', fontWeight: 'bold' }} />
                  </div>
                )}
                <button className="btn btn-primary" onClick={closeInviteModal} style={{ marginTop: 8 }}>
                  Close Modal
                </button>
              </div>
            ) : (
              <form onSubmit={handleInviteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Admin Full Name</label>
                  <input
                    className="input"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Enter name (e.g. John Doe)..."
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    className="input"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Enter email (e.g. john@valuehandlers.com)..."
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Assign Account Roles</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--color-page-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-input)', padding: 12, maxHeight: 180, overflowY: 'auto' }}>
                    {ALL_ROLES.map((role) => (
                      <label key={role.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                        <input
                          type="checkbox"
                          checked={inviteRoles.includes(role.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setInviteRoles([...inviteRoles, role.value]);
                            } else {
                              setInviteRoles(inviteRoles.filter((r) => r !== role.value));
                            }
                          }}
                        />
                        <span style={{ fontWeight: 500 }}>{role.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="button" className="btn btn-outline" onClick={closeInviteModal}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={inviting || inviteRoles.length === 0}>
                    {inviting ? 'Inviting...' : 'Invite Admin'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Roles Modal */}
      {editRolesModalOpen && selectedAdmin && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: 440 }}>
            <button className="modal-close" onClick={() => setEditRolesModalOpen(false)}>×</button>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 8 }}>Edit Account Roles</h3>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 20 }}>
              Updating role permissions for: <strong style={{ color: 'var(--color-text-primary)' }}>{selectedAdmin.name}</strong>
            </div>

            <form onSubmit={handleEditRolesSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Assign Account Roles</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--color-page-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--border-radius-input)', padding: 12 }}>
                  {ALL_ROLES.map((role) => (
                    <label key={role.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                      <input
                        type="checkbox"
                        checked={selectedAdminRoles.includes(role.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAdminRoles([...selectedAdminRoles, role.value]);
                          } else {
                            setSelectedAdminRoles(selectedAdminRoles.filter((r) => r !== role.value));
                          }
                        }}
                      />
                      <span style={{ fontWeight: 500 }}>{role.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn btn-outline" onClick={() => setEditRolesModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={updatingRoles || selectedAdminRoles.length === 0}>
                  {updatingRoles ? 'Updating...' : 'Save Roles'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
