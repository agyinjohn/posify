import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { SHOP_NAME } from '../format.js';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(username, password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="login-brand">
        {/* Decorative blobs */}
        <div className="login-blob login-blob-1" aria-hidden="true" />
        <div className="login-blob login-blob-2" aria-hidden="true" />
        <div className="login-blob login-blob-3" aria-hidden="true" />

        <div className="login-brand-inner">
          {/* Logo mark */}
          <div className="login-logo">
            <svg viewBox="0 0 56 56" fill="none" aria-hidden="true">
              <rect width="56" height="56" rx="16" fill="#E3A62B" />
              <rect x="14" y="16" width="28" height="3.5" rx="1.75" fill="#17212B" />
              <rect x="14" y="24" width="28" height="3.5" rx="1.75" fill="#17212B" />
              <rect x="14" y="32" width="18" height="3.5" rx="1.75" fill="#17212B" />
              <circle cx="40" cy="38" r="6" fill="#17212B" />
              <path d="M37.5 38l1.8 1.8 3.2-3.2" stroke="#E3A62B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <h1>{SHOP_NAME}</h1>
          <p className="login-tagline">Your complete point of sale — built for retail and wholesale shops.</p>

          {/* Feature cards */}
          <div className="login-features">
            <div className="login-feat">
              <span className="login-feat-icon">&#x26A1;</span>
              <div>
                <strong>Fast checkout</strong>
                <small>Barcode scanner, search, split payments</small>
              </div>
            </div>
            <div className="login-feat">
              <span className="login-feat-icon">&#x1F4E6;</span>
              <div>
                <strong>Live stock</strong>
                <small>Movements, stock takes, purchase orders</small>
              </div>
            </div>
            <div className="login-feat">
              <span className="login-feat-icon">&#x1F4CA;</span>
              <div>
                <strong>Reports</strong>
                <small>Daily summary, profit, shift cash-up</small>
              </div>
            </div>
            <div className="login-feat">
              <span className="login-feat-icon">&#x1F465;</span>
              <div>
                <strong>Customers</strong>
                <small>Credit accounts, statements, payments</small>
              </div>
            </div>
          </div>

          {/* Bottom badge */}
          <div className="login-badge">Works offline · Installable PWA · Desktop app</div>
        </div>
      </div>

      <div className="login-panel">
        <form onSubmit={submit} className="login-card">
          <div className="login-card-header">
            <h2>Welcome back</h2>
            <p>Sign in to start selling</p>
          </div>
          <div className="login-field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" autoFocus required placeholder="your username" />
          </div>
          <div className="login-field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" required placeholder="••••••••" />
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="login-btn" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>
      </div>
    </div>
  );
}
