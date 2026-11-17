import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { SHOP_NAME } from '../format.js';
import ForgotPassword from './ForgotPassword.jsx';

function EyeIcon({ open }) {
  return open
    ? <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="10" cy="10" r="2.5"/></svg>
    : <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="10" cy="10" r="2.5"/><line x1="2" y1="2" x2="18" y2="18"/></svg>;
}

export default function Login() {
  const { login, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [view, setView] = useState('login'); // 'login' | 'forgot'

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(username, password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="login-panel">
       <div className="login-stack">
        {view === 'forgot' ? <ForgotPassword onBack={() => setView('login')} defaultUsername={username} /> : (<>
        <form onSubmit={submit} className="login-card">
          <div className="login-head">
            <svg className="login-mark" viewBox="0 0 56 56" fill="none" aria-hidden="true">
              <rect width="56" height="56" rx="16" fill="#E3A62B" />
              <rect x="14" y="16" width="28" height="3.5" rx="1.75" fill="#17212B" />
              <rect x="14" y="24" width="28" height="3.5" rx="1.75" fill="#17212B" />
              <rect x="14" y="32" width="18" height="3.5" rx="1.75" fill="#17212B" />
              <circle cx="40" cy="38" r="6" fill="#17212B" />
              <path d="M37.5 38l1.8 1.8 3.2-3.2" stroke="#E3A62B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h1>{SHOP_NAME}</h1>
          </div>
          <div className="login-field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" autoFocus required autoCapitalize="none" />
          </div>
          <div className="login-field">
            <span>Password</span>
            <div className="pw-wrap">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" required />
              <button type="button" className="pw-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                <EyeIcon open={showPw} />
              </button>
            </div>
          </div>
          {!error && notice && <div className="login-error" role="alert">{notice}</div>}
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="login-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="login-link login-forgot-link" onClick={() => setView('forgot')}>Forgot password?</button>
        </form>
        </>)}
       </div>
      </div>
    </div>
  );
}
