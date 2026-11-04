import { useCallback, useEffect, useState } from 'react';
import { adminApi, hasAdminToken, setAdminToken } from './adminApi.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { dateTime } from '../format.js';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);

export default function AdminApp() {
  const [admin, setAdmin] = useState(null);
  const [checking, setChecking] = useState(hasAdminToken());

  useEffect(() => {
    document.title = 'Posify admin';
    if (hasAdminToken()) adminApi('/me').then((r) => setAdmin(r.admin)).catch(() => setAdminToken('')).finally(() => setChecking(false));
    const out = () => setAdmin(null);
    window.addEventListener('admin:expired', out);
    return () => window.removeEventListener('admin:expired', out);
  }, []);

  if (checking) return <div className="boot">Loading…</div>;
  if (!admin) return <AdminLogin onIn={setAdmin} />;
  return <Shops admin={admin} onOut={() => { setAdminToken(''); setAdmin(null); }} />;
}

function AdminLogin({ onIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await adminApi('/login', { method: 'POST', body: { username, password } }); setAdminToken(r.token); onIn(r.admin); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="force-pw">
      <form className="force-pw-card" onSubmit={submit}>
        <h1>Posify admin</h1>
        <h2>Sign in to manage shops</h2>
        <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        {error && <div className="error">{error}</div>}
        <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
      </form>
    </div>
  );
}

function CopyText({ text, label = 'Copy' }) {
  const toast = useToast();
  return (
    <button type="button" className="ghost-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed. Select the text and copy it by hand', 'err'); }
    }}>{label}</button>
  );
}

// Username + temporary password to hand to a shop owner. Shown until the owner signs in and chooses their own.
function Credentials({ shop }) {
  if (!shop.owner) return <span className="muted-cell">No owner account</span>;
  return (
    <div className="admin-cred">
      <div><span>Username</span><code>{shop.owner.username}</code></div>
      {shop.tempPassword ? (
        <>
          <div><span>Temporary password</span><code>{shop.tempPassword}</code><CopyText text={`Shop: ${shop.name}\nUsername: ${shop.owner.username}\nTemporary password: ${shop.tempPassword}`} label="Copy both" /></div>
          <small>Shown until the owner signs in and sets their own password.</small>
        </>
      ) : (
        <small>Owner set their own password{shop.ownerPasswordChangedAt ? ` on ${dateTime(shop.ownerPasswordChangedAt)}` : ''}. It is not visible here.</small>
      )}
    </div>
  );
}

function Shops({ admin, onOut }) {
  const toast = useToast();
  const [shops, setShops] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null); // { shop, action: 'suspend' | 'reactivate' | 'reset' }
  const [q, setQ] = useState('');
  const [pw, setPw] = useState(false);

  const load = useCallback(() => adminApi('/shops').then(setShops).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); }, [load]);

  const replace = (s) => setShops((list) => list.map((x) => (x.id === s.id ? s : x)));
  const act = async () => {
    const { shop, action } = confirm;
    try {
      const s = action === 'reset'
        ? await adminApi(`/shops/${shop.id}/reset-owner`, { method: 'POST' })
        : await adminApi(`/shops/${shop.id}`, { method: 'PATCH', body: { active: action === 'reactivate' } });
      replace(s);
      toast(action === 'reset' ? 'New temporary password made' : action === 'suspend' ? `${s.name} suspended` : `${s.name} is active again`);
      setConfirm(null);
    } catch (e) { toast(e.message, 'err'); }
  };

  const shown = (shops || []).filter((s) => !q || `${s.name} ${s.owner?.username ?? ''} ${s.owner?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const activeCount = (shops || []).filter((s) => s.active).length;

  return (
    <div className="admin">
      <header className="admin-top">
        <strong>Posify admin</strong>
        <span className="admin-who">{admin.name}</span>
        <button className="ghost" onClick={() => setPw(true)}>Change password</button>
        <button className="ghost" onClick={onOut}>Sign out</button>
      </header>
      <main className="page">
        <div className="page-toolbar">
          <div className="page-toolbar-left">
            <input className="search" placeholder="Search shops or owners" value={q} onChange={(e) => setQ(e.target.value)} />
            {shops && <span className="chip">{shops.length} shop{shops.length !== 1 ? 's' : ''} · {activeCount} active</span>}
          </div>
          <button className="primary" onClick={() => setCreating(true)}>New shop</button>
        </div>
        {shops === null ? <p className="hint">Loading shops…</p> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Shop</th><th>Status</th><th>Owner sign-in</th><th>Created</th><th /></tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong>{s.owner && <><br /><small className="muted-cell">{s.owner.name}</small></>}</td>
                    <td><span className={`badge ${s.active ? 'badge-green' : 'badge-red'}`}>{s.active ? 'Active' : 'Suspended'}</span></td>
                    <td><Credentials shop={s} /></td>
                    <td className="muted-cell">{dateTime(s.createdAt)}</td>
                    <td className="acts">
                      <button onClick={() => setEditing(s)}>Rename</button>
                      <button onClick={() => setConfirm({ shop: s, action: 'reset' })}>Reset owner password</button>
                      {s.active
                        ? <button className="danger" onClick={() => setConfirm({ shop: s, action: 'suspend' })}>Suspend</button>
                        : <button onClick={() => setConfirm({ shop: s, action: 'reactivate' })}>Reactivate</button>}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={5} className="empty">{shops.length ? 'No shop matches.' : 'No shops yet. Create the first one.'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {creating && <NewShop onClose={() => setCreating(false)} onCreated={(s) => setShops((l) => [s, ...(l || [])])} />}
      {editing && <RenameShop shop={editing} onClose={() => setEditing(null)} onSaved={(s) => { replace(s); setEditing(null); }} />}
      {pw && <AdminPassword onClose={() => setPw(false)} />}
      {confirm && (
        <Modal title={{ suspend: `Suspend ${confirm.shop.name}?`, reactivate: `Reactivate ${confirm.shop.name}?`, reset: `Reset the owner's password?` }[confirm.action]} onClose={() => setConfirm(null)}>
          <p>{{
            suspend: 'Nobody in this shop will be able to sign in or use the till until you reactivate it. Their data is kept.',
            reactivate: 'The shop can sign in and sell again straight away.',
            reset: `${confirm.shop.owner?.name ?? 'The owner'} (${confirm.shop.owner?.username ?? 'no owner'}) gets a new temporary password, shown here until they change it. They are signed out on every device.`,
          }[confirm.action]}</p>
          <div className="actions">
            <button onClick={() => setConfirm(null)}>Cancel</button>
            <button className={confirm.action === 'suspend' ? 'danger' : 'primary'} onClick={act}>
              {{ suspend: 'Suspend shop', reactivate: 'Reactivate', reset: 'Make new password' }[confirm.action]}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewShop({ onClose, onCreated }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', ownerName: '', ownerUsername: '', notes: '' });
  const [touched, setTouched] = useState(false); // stop suggesting a username once the admin types one
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'name' && !touched ? { ownerUsername: slug(e.target.value) } : {}) }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const s = await adminApi('/shops', { method: 'POST', body: f }); setCreated(s); onCreated(s); toast('Shop created'); }
    catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  if (created) {
    return (
      <Modal title={`${created.name} is ready`} onClose={onClose}>
        <p>Give these to {created.owner.name}. They sign in at the shop's normal web address and will be asked to choose their own password.</p>
        <Credentials shop={created} />
        <div className="actions"><button className="primary" onClick={onClose}>Done</button></div>
      </Modal>
    );
  }
  return (
    <Modal title="New shop" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Shop name" hint="Printed on receipts and shown in the shop's sidebar"><input value={f.name} onChange={set('name')} required minLength={2} maxLength={80} /></Field>
        <Field label="Owner's full name"><input value={f.ownerName} onChange={set('ownerName')} required minLength={2} maxLength={80} /></Field>
        <Field label="Owner's username" hint="Unique across every shop: this is how sign-in finds the shop. Letters, numbers, dots, dashes.">
          <input value={f.ownerUsername} onChange={(e) => { setTouched(true); set('ownerUsername')(e); }} required minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" autoCapitalize="none" />
        </Field>
        <Field label="Notes (optional)" hint="Only you see these"><input value={f.notes} onChange={set('notes')} maxLength={300} /></Field>
        <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create shop'}</button></div>
      </form>
    </Modal>
  );
}

function RenameShop({ shop, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(shop.name);
  const [notes, setNotes] = useState(shop.notes || '');
  const submit = async (e) => {
    e.preventDefault();
    try { onSaved(await adminApi(`/shops/${shop.id}`, { method: 'PATCH', body: { name, notes } })); toast('Saved'); }
    catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Modal title={`Edit ${shop.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Shop name"><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} /></Field>
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
        <div className="actions"><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

function AdminPassword({ onClose }) {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { const r = await adminApi('/password', { method: 'POST', body: { currentPassword: cur, newPassword: next } }); setAdminToken(r.token); toast('Password changed'); onClose(); }
    catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Modal title="Change your admin password" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Current password"><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 8 characters"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
        <div className="actions"><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}
