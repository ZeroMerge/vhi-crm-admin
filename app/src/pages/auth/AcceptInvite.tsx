import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { authService, InviteError } from '@/services/auth.service';
import logoImg from '@/components/public/logo.png';

// Public page behind the link in the invitation email: /admin/accept-invite?token=…
// The token is read once, then removed from the address bar (history.replaceState) so it doesn't stay in history, bookmarks or
// screenshots; the page sets <meta name="referrer" content="no-referrer"> before any request.

type PageState =
  | { kind: 'checking' }
  | { kind: 'valid'; email: string; name: string | null }
  | { kind: 'invalid'; message: string }
  | { kind: 'expired'; message: string }
  | { kind: 'error'; message: string };

// Same rule as the server (apps/backend/src/utils/passwordPolicy.ts), checked here first for quick feedback.
const MIN_CHARS = 8;
const MAX_BYTES = 72;

function passwordError(password: string, email: string): string | null {
  if (!password) return 'Enter a password.';
  if (Array.from(password).length < MIN_CHARS) return `Use at least ${MIN_CHARS} characters.`;
  if (new TextEncoder().encode(password).length > MAX_BYTES) return 'Use at most 72 characters (fewer with accented letters or emoji).';
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return "Don't use your email address as your password.";
  // The sign-in form trims what is typed, so a password that starts or ends with a space could never be used.
  if (password !== password.trim()) return "Don't start or end the password with a space.";
  return null;
}

const readToken = () => new URLSearchParams(window.location.search).get('token') ?? '';

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [token] = useState(readToken);
  const [state, setState] = useState<PageState>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const inspected = useRef(false);

  // No Referer from this page, then drop the token from the address bar.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    if (inspected.current) return; // once (React StrictMode runs effects twice in development)
    inspected.current = true;
    if (!token) {
      setState({ kind: 'invalid', message: 'This invitation link is incomplete. Open the link from your invitation email again.' });
      return;
    }
    authService
      .inspectInvite(token)
      .then((invite) => setState({ kind: 'valid', email: invite.email, name: invite.name }))
      .catch((err: InviteError) => {
        if (err.code === 'expired') setState({ kind: 'expired', message: err.message });
        else if (err.code === 'invalid') setState({ kind: 'invalid', message: err.message });
        else setState({ kind: 'error', message: err.message });
      });
  }, [token]);

  const email = state.kind === 'valid' ? state.email : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    const pwError = passwordError(password, email);
    if (pwError) next.password = pwError;
    else if (confirmPassword !== password) next.confirm = 'The passwords do not match.';
    setErrors(next);
    if (next.password) return passwordRef.current?.focus();
    if (next.confirm) return confirmRef.current?.focus();

    setSubmitting(true);
    try {
      const result = await authService.acceptInvite({ token, password, confirmPassword });
      navigate(`/admin/login?email=${encodeURIComponent(result.email)}&invited=1`, { replace: true });
    } catch (err) {
      const e2 = err as InviteError;
      if (e2.code === 'password') {
        setErrors({ password: e2.message });
        passwordRef.current?.focus();
      } else if (e2.code === 'expired') {
        setState({ kind: 'expired', message: e2.message });
      } else if (e2.code === 'invalid') {
        setState({ kind: 'invalid', message: e2.message });
      } else {
        setErrors({ form: e2.message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const errorText = (id: string, text?: string) =>
    text ? (
      <p id={id} style={{ margin: '6px 0 0', color: 'var(--color-status-cancelled-text)', fontSize: 'var(--font-size-xs)', fontWeight: 500 }}>
        {text}
      </p>
    ) : null;

  const notice = (title: string, message: string, extra?: string) => (
    <div role="alert" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 12px' }}>{title}</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: '0 0 8px' }}>{message}</p>
      {extra && <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{extra}</p>}
    </div>
  );

  return (
    <div className="page-wrapper flex items-center justify-center" style={{ minHeight: '100vh', padding: '24px 16px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '420px', padding: 'clamp(24px, 6vw, 40px) clamp(20px, 5vw, 32px)' }}>
        <div className="text-center" style={{ marginBottom: '28px' }}>
          <img src={logoImg} alt="ValueHandlers Logo" style={{ height: '32px', margin: '0 auto' }} />
        </div>

        {state.kind === 'checking' && (
          <p role="status" style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
            Checking your invitation…
          </p>
        )}

        {state.kind === 'invalid' && notice("This link can't be used", state.message, 'If you already set your password, sign in instead.')}
        {state.kind === 'expired' && notice('This invitation has expired', state.message, 'Ask your super admin to resend the invitation.')}
        {state.kind === 'error' && notice("We couldn't check your invitation", state.message)}

        {(state.kind === 'invalid' || state.kind === 'expired') && (
          <div className="text-center" style={{ marginTop: 20 }}>
            <a href="/admin/login" className="btn btn-outline" style={{ justifyContent: 'center' }}>
              Go to sign in
            </a>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="text-center" style={{ marginTop: 20 }}>
            <button type="button" className="btn btn-outline" onClick={() => window.location.reload()} style={{ justifyContent: 'center' }}>
              Try again
            </button>
          </div>
        )}

        {state.kind === 'valid' && (
          <>
            <div className="text-center" style={{ marginBottom: '24px' }}>
              <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>
                Set your password
              </h1>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', margin: 0, wordBreak: 'break-word' }}>
                Set a password for <strong>{state.email}</strong>
              </p>
            </div>

            {errors.form && (
              <div role="alert" style={{ padding: '12px 16px', background: 'var(--color-status-cancelled-bg)', color: 'var(--color-status-cancelled-text)', borderRadius: 'var(--border-radius-sm)', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 20, textAlign: 'center' }}>
                {errors.form}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              {/* Lets password managers save the new password against the right account. */}
              <input type="email" name="username" autoComplete="username" value={state.email} readOnly hidden />

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" htmlFor="invite-password">New password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="invite-password"
                    ref={passwordRef}
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={`invite-password-rules${errors.password ? ' invite-password-error' : ''}`}
                    style={{ paddingRight: 44 }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    aria-controls="invite-password invite-confirm"
                    style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <ul id="invite-password-rules" style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', lineHeight: 1.6 }}>
                  <li>8 to 72 characters</li>
                  <li>Not your email address</li>
                </ul>
                {errorText('invite-password-error', errors.password)}
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label" htmlFor="invite-confirm">Confirm password</label>
                <input
                  id="invite-confirm"
                  ref={confirmRef}
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={Boolean(errors.confirm)}
                  aria-describedby={errors.confirm ? 'invite-confirm-error' : undefined}
                />
                {errorText('invite-confirm-error', errors.confirm)}
              </div>

              <button type="submit" className="btn btn-primary w-full" disabled={submitting} style={{ justifyContent: 'center' }}>
                {submitting ? 'Setting password…' : 'Set password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
