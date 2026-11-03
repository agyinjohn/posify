import { useState } from 'react';
import { api } from '../api.js';

// Owner self-service reset from the login page: username + one of the recovery codes saved earlier.
export default function ForgotPassword({ onBack, defaultUsername = '' }) {
  const [username, setUsername] = useState(defaultUsername);
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const mismatch = again !== '' && next !== again;
  const submit = async (e) => {
    e.preventDefault();
    if (next !== again) return setError('The two new passwords are different');
    setBusy(true); setError('');
    try { setDone(await api('/auth/recover', { method: 'POST', body: { username, code, newPassword: next } })); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="login-card">
        <div className="login-card-header">
          <h2>Password changed</h2>
          <p>Every device that was signed in to this account has been signed out. Sign in with your new password.</p>
        </div>
        {done.codesLeft <= 2 && (
          <div className="login-note">
            {done.codesLeft === 0 ? 'That was your last recovery code.' : `Only ${done.codesLeft} recovery code${done.codesLeft === 1 ? '' : 's'} left.`}{' '}
            After you sign in, make a new set from the profile menu (Recovery codes).
          </div>
        )}
        <button className="login-btn" onClick={onBack}>Back to sign in</button>
      </div>
    );
  }

  const type = show ? 'text' : 'password';
  return (
    <form onSubmit={submit} className="login-card">
      <div className="login-card-header">
        <h2>Forgot password</h2>
        <p>Owner accounts can reset the password with one of their recovery codes. Staff: ask the owner to reset it for you.</p>
      </div>
      <div className="login-field">
        <span>Username</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus placeholder="owner username" />
      </div>
      <div className="login-field">
        <span>Recovery code</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="XXXXX-XXXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </div>
      <div className="login-field">
        <span>New password</span>
        <input type={type} value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" placeholder="at least 8 characters" />
      </div>
      <div className="login-field">
        <span>New password again</span>
        <input type={type} value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" />
      </div>
      <label className="login-show"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
      {mismatch && <div className="login-error" role="alert">The two new passwords are different</div>}
      {error && <div className="login-error" role="alert">{error}</div>}
      <button className="login-btn" disabled={busy || mismatch}>{busy ? 'Checking…' : 'Reset password'}</button>
      <button type="button" className="login-link login-back" onClick={onBack}>← Back to sign in</button>
    </form>
  );
}
