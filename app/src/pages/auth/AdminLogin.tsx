import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth.service';
import { RoleSelectorModal } from '@/components/auth/RoleSelectorModal';
import type { AdminRole } from '@/types';

// Importing the logo based on your specific file path
import logoImg from '@/components/public/logo.png';

export default function AdminLogin() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // States for role selection
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [rolesToSelect, setRolesToSelect] = useState<AdminRole[]>([]);

  const handleLoginAttempt = async (selectedRole?: AdminRole) => {
    setError('');
    setLoading(true);

    try {
      const response = await authService.login({
        email: email.trim().toLowerCase(),
        password: password.trim(),
        selectedRole
      });

      if (response.requiresRoleSelection && response.assignedRoles) {
        setRolesToSelect(response.assignedRoles);
        setShowRoleModal(true);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLoginAttempt();
  };

  const handleSelectRole = (role: AdminRole) => {
    setShowRoleModal(false);
    handleLoginAttempt(role);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffffff', // Clean white background like the picture
        padding: '20px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400, // Slightly slimmer to match the screenshot proportions
          background: '#ffffff',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <img 
            src={logoImg} 
            alt="ValueHandlers International Limited" 
            style={{ 
              height: '60px', 
              objectFit: 'contain',
              margin: '0 auto' 
            }} 
          />
        </div>

        {/* Welcome Text */}
        <h1 style={{ 
          fontSize: '24px', 
          fontWeight: 600, 
          color: '#0f172a', 
          textAlign: 'center',
          marginBottom: '32px' 
        }}>
          Welcome Back!
        </h1>

        <form onSubmit={handleSubmit}>
          {error && (
            <div
              style={{
                padding: '12px 16px',
                background: '#fee2e2',
                color: '#991b1b',
                borderRadius: 'var(--radius-input)',
                fontSize: '14px',
                marginBottom: '16px',
              }}
            >
              {error}
            </div>
          )}

          {/* Email Input */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '14px', 
              fontWeight: 500, 
              color: '#334155', 
              marginBottom: '8px' 
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
                borderRadius: 'var(--radius-input)', // Standard subtle border instead of heavy pill shape
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                color: '#334155'
              }}
              onFocus={(e) => e.target.style.borderColor = '#9A2A8B'}
              onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
            />
          </div>

          {/* Password Input */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '14px', 
              fontWeight: 500, 
              color: '#334155', 
              marginBottom: '8px' 
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
                borderRadius: 'var(--radius-input)', // Standard subtle border
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                color: '#334155'
              }}
              onFocus={(e) => e.target.style.borderColor = '#9A2A8B'}
              onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{ 
              width: '100%', 
              padding: '14px',
              backgroundColor: '#9A2A8B', // VHI Purple
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-button)', // Standard subtle border
              fontSize: '15px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
              transition: 'background-color 0.2s'
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        {/* Footer Note */}
        <p style={{ 
          textAlign: 'center', 
          marginTop: '24px', 
          fontSize: '14px', 
          color: '#64748b' 
        }}>
          Need access? Contact your administrator for an invitation.
        </p>
      </div>

      {/* Role Selection Modal (Unchanged structurally) */}
      {showRoleModal && (
        <RoleSelectorModal
          roles={rolesToSelect}
          onSelectRole={handleSelectRole}
          onCancel={() => setShowRoleModal(false)}
        />
      )}
    </div>
  );
}