import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { Field, Modal, useToast } from '../ui.jsx';
import { SHOP_NAME } from '../format.js';

// Same form for the profile-menu "Change password" and for the forced screen after an owner hands out a temporary password.
export function ChangePasswordForm({ forced, onDone }) {
  const { changePassword, user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const mismatch = again !== '' && next !== again;

  const submit = async (e) => {
    e.preventDefault();
    if (next !== again) return setError('The two new passwords are different');
    setBusy(true); setError('');
    try {
      await changePassword(current, next);
      toast('Password changed');
      onDone?.();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  const type = show ? 'text' : 'password';
  return (
    <form onSubmit={submit}>
      {forced && <p className="hint">Hi {user.name}. The owner gave you a temporary password. Choose your own to continue.</p>}
      <Field label={forced ? 'Temporary password' : 'Current password'}>
        <input type={type} value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
      </Field>
      <Field label="New password" hint="At least 8 characters. Not your username or a common password">
        <input type={type} value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" />
      </Field>
      <Field label="New password again" hint={mismatch ? 'These do not match yet' : undefined}>
        <input type={type} value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" />
      </Field>
      <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button className="primary" disabled={busy || mismatch}>{busy ? 'Saving…' : 'Save new password'}</button>
      </div>
    </form>
  );
}

export function ChangePasswordModal({ onClose }) {
  return (
    <Modal title="Change password" onClose={onClose}>
      <ChangePasswordForm onDone={onClose} />
    </Modal>
  );
}

// Shown instead of the app until a temporary password has been replaced.
export default function ForcePasswordChange() {
  const { logout } = useAuth();
  return (
    <div className="force-pw">
      <div className="force-pw-card">
        <h1>{SHOP_NAME}</h1>
        <h2>Choose a new password</h2>
        <ChangePasswordForm forced />
        <button className="ghost" type="button" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
