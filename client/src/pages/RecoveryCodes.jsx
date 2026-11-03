import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { SHOP_NAME, dateTime } from '../format.js';

// Owner's own recovery-code status, so the app can nudge when none are set up or few are left.
export function useRecoveryStatus(enabled) {
  const [status, setStatus] = useState(null);
  const refresh = useCallback(() => {
    if (!enabled) return;
    api('/auth/recovery-codes').then(setStatus).catch(() => {});
  }, [enabled]);
  useEffect(() => { refresh(); }, [refresh]);
  return [status, refresh];
}

export const recoveryNeedsAttention = (status) => status !== null && status.remaining <= 2;

export function RecoveryCodesModal({ onClose, status, onChanged }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState(null); // { codes, createdAt } right after generating: shown once
  const [saved, setSaved] = useState(false);

  const generate = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setFresh(await api('/auth/recovery-codes', { method: 'POST', body: { currentPassword: password } })); setPassword(''); onChanged?.(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const text = fresh ? `${SHOP_NAME} owner recovery codes\nMade ${dateTime(fresh.createdAt)}\nEach code works once.\n\n${fresh.codes.join('\n')}\n` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('Codes copied'); } catch { toast('Could not copy. Select the codes and copy them by hand', 'err'); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'recovery-codes.txt' });
    a.click(); URL.revokeObjectURL(url);
  };

  // Once generated, the sheet must be acknowledged before it can be closed: it is never shown again.
  const close = () => { if (fresh && !saved) return toast('Save the codes first, then tick the box. They are never shown again', 'err'); onClose(); };

  return (
    <Modal title="Recovery codes" onClose={close}>
      {!fresh && (
        <>
          <p className="hint">
            If you ever forget your password, a recovery code lets you set a new one from the sign-in page ("Forgot your password?"), with no help needed.
            Each code works once. Keep them somewhere safe and private, like a password manager or a printed sheet in a locked drawer.
          </p>
          <div className={`recovery-status${status && status.remaining <= 2 ? ' low' : ''}`}>
            {status === null ? 'Checking…'
              : status.createdAt ? <><strong>{status.remaining} of {status.total}</strong> codes unused <small>· made {dateTime(status.createdAt)}</small></>
              : <strong>No recovery codes yet</strong>}
          </div>
          <form onSubmit={generate}>
            <Field label="Your current password" hint={status?.createdAt ? 'Making a new set cancels your old codes.' : 'Needed to make the codes.'}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </Field>
            {error && <div className="error">{error}</div>}
            <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Making codes…' : status?.createdAt ? 'Make a new set of codes' : 'Make recovery codes'}</button></div>
          </form>
        </>
      )}
      {fresh && (
        <>
          <div className="notice"><strong>Save these now.</strong> They are shown only this once. Anyone who has a code can reset your password, so keep them private.</div>
          <div className="recovery-sheet print-area">
            <strong>{SHOP_NAME} owner recovery codes</strong>
            <small>Made {dateTime(fresh.createdAt)} · each code works once</small>
            <ol>{fresh.codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
          </div>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" onClick={copy}>Copy</button>
            <button type="button" onClick={download}>Download</button>
            <button type="button" onClick={() => window.print()}>Print</button>
          </div>
          <label className="check" style={{ whiteSpace: 'normal', marginTop: '.8rem' }}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes somewhere safe
          </label>
          <div className="actions"><button className="primary" disabled={!saved} onClick={onClose}>Done</button></div>
        </>
      )}
    </Modal>
  );
}
