import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth.service';
import logoImg from '@/components/public/logo.png';


export default function AdminLogin() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const verified = await authService.verifyEmail(email.trim().toLowerCase());
      if (verified) {
        setStep(2);
      }
    } catch (err: any) {
      setError(err.message || 'Error verifying email');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authService.login({
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });

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

  return (
    <div className="page-wrapper flex items-center justify-center" style={{ minHeight: '100vh', padding: '24px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <div className="text-center" style={{ marginBottom: '40px' }}>
          <img
            src={logoImg}
            alt="ValueHandlers Logo"
            style={{ height: '32px', margin: '0 auto 24px auto' }}
          />
          <h1 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 8px 0' }}>
            {step === 1 ? 'Sign in to admin' : 'Welcome back'}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
            {step === 1 ? 'Enter your email to continue.' : email}
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--color-status-cancelled-bg)',
              color: 'var(--color-status-cancelled-text)',
              borderRadius: 'var(--border-radius-sm)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 500,
              marginBottom: '24px',
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleEmailVerify}>
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Email address</label>
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={loading || !email}
              style={{ justifyContent: 'center' }}
            >
              {loading ? 'Verifying...' : 'Continue'}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePasswordLogin}>
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Password</label>
              <input
                className="input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={loading || !password}
              style={{ justifyContent: 'center', marginBottom: '16px' }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setPassword('');
                  setError('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-secondary)',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                ← Back to email
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
