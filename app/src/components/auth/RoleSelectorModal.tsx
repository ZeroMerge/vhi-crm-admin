import React from 'react';
import { Shield, User, Truck, Users, HelpCircle, Crown, Trophy, Medal, Briefcase, FileText, PieChart } from 'lucide-react';
import type { AdminRole } from '@/types';

interface RoleSelectorModalProps {
  roles: AdminRole[];
  onSelectRole: (role: AdminRole) => void;
  onCancel: () => void;
}

// Mapped exact colors with highly pale, translucent backgrounds
const roleMeta: Record<string, { title: string; icon: React.ElementType; color: string; bg: string }> = {
  super_admin: { title: 'Super Admin', icon: Crown, color: '#d97706', bg: '#fef3c7' },
  manager: { title: 'Manager', icon: Trophy, color: '#4b5563', bg: '#f3f4f6' },
  finance_officer: { title: 'Finance Officer', icon: Medal, color: '#b91c1c', bg: '#fee2e2' },
  logistics_officer: { title: 'Logistics Officer', icon: Truck, color: '#1d4ed8', bg: '#dbeafe' },
  crm_officer: { title: 'CRM Officer', icon: Users, color: '#15803d', bg: '#dcfce7' },
  support_staff: { title: 'Support Staff', icon: HelpCircle, color: '#475569', bg: '#f1f5f9' },
  
  executive: { title: 'Executive', icon: Briefcase, color: '#4338ca', bg: '#e0e7ff' },
  operations_manager: { title: 'Operations', icon: Shield, color: '#0e7490', bg: '#cffafe' },
  account_officer: { title: 'Account Officer', icon: FileText, color: '#be123c', bg: '#ffe4e6' },
  sales_officer: { title: 'Sales Officer', icon: PieChart, color: '#be185d', bg: '#fce7f3' },
  staff: { title: 'General Staff', icon: User, color: '#3f3f46', bg: '#f4f4f5' },
};

export const RoleSelectorModal: React.FC<RoleSelectorModalProps> = ({ roles, onSelectRole, onCancel }) => {
  return (
    <>
      <style>
        {`
          .role-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 9999px; /* Back to perfect pills */
            border: 1.5px solid #e2e8f0;
            background: #ffffff;
            color: #475569;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
          }
          .role-pill:hover {
            border-color: var(--pill-color);
            background: var(--pill-bg);
            color: var(--pill-color);
            transform: translateY(-1px);
            box-shadow: 0 4px 6px rgba(0,0,0,0.04);
          }
          .role-pill-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            color: #94a3b8;
          }
          .role-pill:hover .role-pill-icon {
            color: var(--pill-color);
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
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 1100,
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
      >
        <div
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: '16px', 
            width: '100%',
            maxWidth: '520px', /* Very compact for pills */
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header Typography */}
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h2 style={{ 
              fontSize: '22px', 
              fontWeight: 800, 
              color: '#0f172a',
              margin: '0 0 8px 0',
              letterSpacing: '-0.02em'
            }}>
              Select Role Level
            </h2>
            <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
              Choose your administrative access level.
            </p>
          </div>

          {/* Flex Wrapped Pills Container */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '28px',
            width: '100%',
          }}>
            {roles.map((role) => {
              const meta = roleMeta[role] || {
                title: role.replace(/_/g, ' '),
                icon: User,
                color: '#64748b',
                bg: '#f1f5f9',
              };
              const Icon = meta.icon;

              return (
                <div
                  key={role}
                  className="role-pill"
                  style={{ 
                    '--pill-color': meta.color, 
                    '--pill-bg': meta.bg 
                  } as React.CSSProperties}
                  onClick={() => onSelectRole(role)}
                >
                  <div className="role-pill-icon">
                    <Icon size={16} strokeWidth={2.5} fill="currentColor" />
                  </div>
                  {meta.title}
                </div>
              );
            })}
          </div>

          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            width: '100%'
          }}>
            <button
              onClick={onCancel}
              style={{
                padding: '4px 8px',
                backgroundColor: 'transparent',
                border: 'none',
                fontSize: '13px',
                fontWeight: 500,
                color: '#94a3b8',
                cursor: 'pointer',
                textDecoration: 'underline',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#475569';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#94a3b8';
              }}
            >
              Cancel Login
            </button>
          </div>
        </div>
      </div>
    </>
  );
};