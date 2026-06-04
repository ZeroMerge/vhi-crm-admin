import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Truck, Users, HelpCircle, Crown, Trophy, Medal } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth.service';
import type { AdminRole } from '@/types';

// Mapped roles for selection
const roleMeta: Record<string, { title: string; icon: React.ElementType }> = {
  super_admin: { title: 'Super Admin', icon: Crown },
  manager: { title: 'Manager', icon: Trophy },
  finance_officer: { title: 'Finance Officer', icon: Medal },
  logistics_officer: { title: 'Logistics Officer', icon: Truck },
  crm_officer: { title: 'CRM Officer', icon: Users },
  support_staff: { title: 'Support Staff', icon: HelpCircle },
};

export default function AdminLogin() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [rolesToSelect, setRolesToSelect] = useState<AdminRole[]>([]);
  const [pendingRole, setPendingRole] = useState<AdminRole | null>(null);

  const handleLoginAttempt = async (selectedRole?: AdminRole) => {
    setError('');
    setLoading(true);

    try {
      const response = await authService.login({
        email: email.trim().toLowerCase(),
        password: password.trim(),
        selectedRole,
      });

      if (response.requiresRoleSelection && response.assignedRoles) {
        setRolesToSelect(response.assignedRoles);
        setShowRoleSelection(true);
        setLoading(false);
        return;
      }

      if (response.token && response.admin) {
        setAuth(response.admin, response.token);
        const role = response.admin.activeRole;
        if (role === 'super_admin' || role === 'manager') {
          navigate('/admin');
        } else if (role === 'finance_officer') {
          navigate('/admin/invoices');
        } else if (role === 'logistics_officer' || role === 'support_staff') {
          navigate('/admin/shipments');
        } else {
          navigate('/admin/customers');
        }
      } else {
        setError('Failed to authenticate. Try again.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleClick = (role: AdminRole) => {
    setPendingRole(role);
    setTimeout(() => {
      handleLoginAttempt(role);
    }, 180);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLoginAttempt();
  };

  // Step 2: Role Selection
  if (showRoleSelection && rolesToSelect.length > 0) {
    return (
      <div style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: '#ffffff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <style>{`
          .role-form-panel {
            width: 50%;
            min-width: 380px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 60px 8%;
          }
          .pills-container {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 40px;
          }
          @media (max-width: 900px) {
            .role-dashboard-panel { display: none !important; }
            .role-form-panel { 
              width: 100% !important;
              align-items: center;
              text-align: center;
              padding: 40px 5% !important;
            }
            .pills-container {
              justify-content: center;
            }
            .back-btn {
              align-self: center !important;
            }
          }
          .back-btn {
            padding: 0;
            background: transparent;
            border: none;
            font-size: 14px;
            font-weight: 500;
            color: #9ca3af;
            cursor: pointer;
            text-decoration: underline;
            align-self: flex-start;
          }
          .role-chip {
            display: inline-flex;
            align-items: center;
            padding: 8px 14px;
            border-radius: 4px; /* 4px radius as requested */
            background: #f3f4f6;
            color: #1f2937;
            font-size: 13.5px;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid transparent;
            transition: background 0.2s ease, border-color 0.2s ease; /* Just color change */
            user-select: none;
            white-space: nowrap;
          }
          .role-chip:hover {
            border-color: #d1d5db;
            background: #e5e7eb;
          }
          .role-chip.selected {
            border-color: #9A2A8B;
            background: #9A2A8B;
            color: #ffffff;
          }
        `}</style>

        {/* Left: Form */}
        <div className="role-form-panel">
          {/* Step Indicator */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '40px' }}>
            {/* Step 1: complete — fully filled */}
            <div style={{
              height: '3px',
              width: '56px',
              borderRadius: '2px',
              background: '#111827',
            }} />
            {/* Step 2: in progress — left half filled, right half grey */}
            <div style={{
              height: '3px',
              width: '56px',
              borderRadius: '2px',
              background: 'linear-gradient(to right, #111827 50%, #e5e7eb 50%)',
            }} />
          </div>

          <h2 style={{
            fontSize: '36px', /* Used size for hierarchy instead of bold */
            fontWeight: 400, /* Removed bold */
            color: '#111827',
            margin: '0 0 8px 0',
            letterSpacing: '-0.03em',
            lineHeight: '1.2',
          }}>
            Select your position
          </h2>
          <p style={{
            margin: '0 0 32px 0',
            color: '#6b7280',
            fontSize: '16px',
            lineHeight: '1.6',
          }}>
            Your account has multiple roles. Choose the one you want to sign in as for this session.
          </p>

          <div className="pills-container">
            {rolesToSelect
              .filter(role => roleMeta[role]) // Filter out extraneous roles
              .map((role) => {
              const meta = roleMeta[role];
              return (
                <div
                  key={role}
                  className={`role-chip${pendingRole === role ? ' selected' : ''}`}
                  onClick={() => handleRoleClick(role)}
                >
                  {meta.title}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => {
              setShowRoleSelection(false);
              setRolesToSelect([]);
              setPendingRole(null);
            }}
            className="back-btn"
          >
            ← Back to login
          </button>
        </div>

        {/* Right: Dashboard Image */}
        <div
          className="role-dashboard-panel"
          style={{
            flex: 1,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <img
            src="/images/dashboard.png"
            alt="Dashboard Preview"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'left top',
              display: 'block',
            }}
          />
        </div>
      </div>
    );
  }

  // Step 1: Login Form (unchanged)
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffffff',
        padding: '20px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400, background: '#ffffff' }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: 600,
          color: '#0f172a',
          textAlign: 'center',
          marginBottom: '32px',
        }}>
          Welcome Back!
        </h1>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              padding: '12px 16px',
              background: '#fee2e2',
              color: '#991b1b',
              borderRadius: 'var(--radius-input)',
              fontSize: '14px',
              marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: 500,
              color: '#334155',
              marginBottom: '8px',
            }}>
              E-mail
            </label>
            <input
              type="email"
              placeholder="e.g vivian@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px 16px',
                border: '1px solid #cbd5e1',
                borderRadius: 'var(--radius-input)',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                color: '#334155',
              }}
              onFocus={(e) => e.target.style.borderColor = '#9A2A8B'}
              onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: 500,
              color: '#334155',
              marginBottom: '8px',
            }}>
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px 16px',
                border: '1px solid #cbd5e1',
                borderRadius: 'var(--radius-input)',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                color: '#334155',
              }}
              onFocus={(e) => e.target.style.borderColor = '#9A2A8B'}
              onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: '#9A2A8B',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-button)',
              fontSize: '15px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
              transition: 'background-color 0.2s',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        <p style={{
          textAlign: 'center',
          marginTop: '24px',
          fontSize: '14px',
          color: '#64748b',
        }}>
          Need access? Contact your administrator for an invitation.
        </p>
      </div>
    </div>
  );
}
