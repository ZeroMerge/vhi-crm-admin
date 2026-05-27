import React from 'react';
import { Shield, User, Truck, DollarSign, Users, HelpCircle } from 'lucide-react';
import type { AdminRole } from '@/types';

interface RoleSelectorModalProps {
  roles: AdminRole[];
  onSelectRole: (role: AdminRole) => void;
  onCancel: () => void;
}

// Mapped exact colors and backgrounds to match the high-end UI image
const roleMeta: Record<AdminRole, { title: string; desc: string; icon: any; color: string; bg: string }> = {
  super_admin: {
    title: 'Super Admin',
    desc: 'Unrestricted master access to all platform settings, admins, and databases.',
    icon: Shield,
    color: '#8b5cf6', // Soft Purple
    bg: '#f5f3ff',
  },
  manager: {
    title: 'Manager',
    desc: 'Access to operations, shipments, billing, communications, and reporting.',
    icon: User,
    color: '#ec4899', // Soft Pink
    bg: '#fdf2f8',
  },
  logistics_officer: {
    title: 'Logistics Officer',
    desc: 'Focus on tracking updates, shipping modes, origin-destination details, and cargo.',
    icon: Truck,
    color: '#3b82f6', // Soft Blue
    bg: '#eff6ff',
  },
  finance_officer: {
    title: 'Finance Officer',
    desc: 'Manage billing statements, currency metrics, record payments, and revenue.',
    icon: DollarSign,
    color: '#22c55e', // Soft Green
    bg: '#f0fdf4',
  },
  crm_officer: {
    title: 'CRM Officer',
    desc: 'Manage customer accounts, star ratings, broadcast newsletters, and audience groups.',
    icon: Users,
    color: '#ea580c', // Soft Orange
    bg: '#fff7ed',
  },
  support_staff: {
    title: 'Support Staff (Read-Only)',
    desc: 'View-only status updates, shipments logs, and messaging (cannot edit financial records).',
    icon: HelpCircle,
    color: '#475569', // Slate Gray
    bg: '#f8fafc',
  },
};

export const RoleSelectorModal: React.FC<RoleSelectorModalProps> = ({ roles, onSelectRole, onCancel }) => {
  return (
    <>
      {/* Inline styles for the hover effect to keep it self-contained */}
      <style>
        {`
          .role-card {
            transition: all 0.2s ease;
          }
          .role-card:hover {
            border-color: #cbd5e1 !important;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
            transform: translateY(-2px);
          }
        `}
      </style>

      {/* Backdrop */}
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 1100,
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        {/* Modal Container */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '780px', // Widened to fit the 2-column layout beautifully
            padding: '40px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            animation: 'scaleIn 0.2s ease-out',
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h2 style={{ 
              fontSize: '22px', 
              fontWeight: 600, 
              color: '#0f172a', 
              margin: '0 0 8px 0' 
            }}>
              Choose Your Active Role
            </h2>
            <p style={{ 
              fontSize: '15px', 
              color: '#64748b', 
              margin: 0 
            }}>
              Your account has multiple roles assigned. Select the role you want to start as for this session.
            </p>
          </div>

          {/* Grid Layout for Roles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
              marginBottom: '32px',
              maxHeight: '60vh',
              overflowY: 'auto',
              padding: '4px',
            }}
          >
            {roles.map((role) => {
              const meta = roleMeta[role] || {
                title: role,
                desc: 'Select to log in with this role.',
                icon: User,
                color: '#64748b',
                bg: '#f8fafc',
              };
              const Icon = meta.icon;

              return (
                <div
                  key={role}
                  className="role-card"
                  onClick={() => onSelectRole(role)}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '20px',
                    cursor: 'pointer',
                    backgroundColor: '#ffffff',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '16px',
                  }}
                >
                  {/* Icon Container with specific pastel background */}
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '10px',
                      backgroundColor: meta.bg,
                      color: meta.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={22} strokeWidth={2} />
                  </div>
                  
                  {/* Text Container */}
                  <div>
                    <h4 style={{ 
                      fontSize: '15px', 
                      fontWeight: 600, 
                      color: '#0f172a', 
                      margin: '0 0 6px 0' 
                    }}>
                      {meta.title}
                    </h4>
                    <p style={{ 
                      fontSize: '13px', 
                      color: '#64748b', 
                      lineHeight: '1.5',
                      margin: 0 
                    }}>
                      {meta.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={onCancel}
              style={{
                padding: '10px 24px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#475569',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
};