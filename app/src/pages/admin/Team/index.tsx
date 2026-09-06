import { useState, useEffect } from 'react';
import { PageWrapper } from '@/components/layout/PageWrapper';
import { useAuthStore } from '@/store/authStore';
import { Avatar } from '@/components/shared/Avatar';
import { Switch } from '@/components/ui/switch';
import { adminManagementService, type AdminUser } from '@/services/admin-management.service';
import { Plus, Trash2, Edit, Key } from 'lucide-react';

const ALL_ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: '#7B2D8B' },
  { value: 'manager', label: 'Manager', color: '#1565C0' },
  { value: 'logistics_officer', label: 'Logistics Officer', color: '#2E7D32' },
  { value: 'finance_officer', label: 'Finance Officer', color: '#00838F' },
  { value: 'crm_officer', label: 'CRM Officer', color: '#E65100' },
  { value: 'support_staff', label: 'Support Staff', color: '#C62828' }
];

export default function Team() {
  const { admin } = useAuthStore();
  const isSuperAdmin = admin?.activeRole === 'super_admin';

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  
  // Modals
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

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);

  useEffect(() => {
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
  }, []);

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

  const openResetPasswordModal = (user: AdminUser) => {
    setSelectedAdmin(user);
    setNewAdminPassword('');
    setPasswordModalOpen(true);
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmin || !newAdminPassword.trim()) {
      alert('Please provide a new password.');
      return;
    }
    setResettingPassword(true);
    try {
      await adminManagementService.resetPassword(selectedAdmin.id, newAdminPassword);
      alert('Password updated successfully for ' + selectedAdmin.name);
      setPasswordModalOpen(false);
      setSelectedAdmin(null);
    } catch (err) {
      console.error('Failed to reset password:', err);
      alert('Failed to reset admin password.');
    } finally {
      setResettingPassword(false);
    }
  };

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

  return (
    <PageWrapper title="Team Management">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ 
          background: 'var(--color-surface)', 
          borderRadius: '12px', 
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title" style={{ marginBottom: 0 }}>System Administrators</h3>
            {isSuperAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => setInviteModalOpen(true)}>
                <Plus size={14} style={{ marginRight: 6 }} />
                Invite Admin
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto', width: '100%' }}>
            {loadingAdmins ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                Loading administrator accounts...
              </div>
            ) : admins.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No administrators found.
              </div>
            ) : (
              <table className="vhi-table" style={{ whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email Address</th>
                    <th>Assigned Roles</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th style={{ width: 140 }}>Actions</th>
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
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', alignItems: 'center' }}>
                          {(() => {
                            if (adm.assigned_roles?.includes('super_admin')) {
                              return (
                                <span style={{ background: '#000', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  Super Admin
                                </span>
                              );
                            }

                            const rolesToRender = adm.assigned_roles?.slice(0, 2) || [];
                            const hiddenCount = (adm.assigned_roles?.length || 0) - 2;

                            return (
                              <>
                                {rolesToRender.map((role: string) => {
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
                                {hiddenCount > 0 && (
                                  <span
                                    title={adm.assigned_roles?.slice(2).map(r => r.replace(/_/g, ' ')).join(', ')}
                                    style={{
                                      background: 'var(--color-border)',
                                      color: 'var(--color-text-secondary)',
                                      fontSize: 10,
                                      padding: '2px 8px',
                                      borderRadius: 'var(--border-radius-pill)',
                                      fontWeight: 600,
                                      cursor: 'help'
                                    }}
                                  >
                                    +{hiddenCount} more
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Switch
                            checked={adm.is_active}
                            disabled={adm.id === admin?.id}
                            onCheckedChange={() => handleToggleAdminStatus(adm.id, adm.is_active)}
                          />
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '13px', color: '#64748b' }}>
                          {adm.last_login_at ? new Date(adm.last_login_at).toLocaleString() : 'Never'}
                        </span>
                      </td>
                      <td>
                        {isSuperAdmin ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-icon btn-ghost" title="Edit Password" style={{ width: 28, height: 28 }} onClick={() => openResetPasswordModal(adm)}>
                              <Key size={14} />
                            </button>
                            <button className="btn btn-icon btn-ghost" title="Edit Roles" style={{ width: 28, height: 28 }} onClick={() => openEditRolesModal(adm)}>
                              <Edit size={14} />
                            </button>
                            <button
                              className="btn btn-icon btn-ghost text-red"
                              title="Delete Admin"
                              style={{ width: 28, height: 28, color: 'var(--color-status-cancelled-text)' }}
                              disabled={adm.id === admin?.id}
                              onClick={() => handleDeleteAdmin(adm.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>No access</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Password Reset Modal */}
      {passwordModalOpen && selectedAdmin && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: 440 }}>
            <button className="modal-close" onClick={() => setPasswordModalOpen(false)}>×</button>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 8 }}>Edit Account Password</h3>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 20 }}>
              Updating password for: <strong style={{ color: 'var(--color-text-primary)' }}>{selectedAdmin.name}</strong>.
            </div>

            <form onSubmit={handleResetPasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  className="input"
                  type="text"
                  required
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  placeholder="Enter new password..."
                />
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn btn-outline" onClick={() => setPasswordModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={resettingPassword || !newAdminPassword.trim()}>
                  {resettingPassword ? 'Updating...' : 'Save New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
