import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi, hasAdminToken, setAdminToken } from './adminApi.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { dateTime } from '../format.js';
import { ChevronDown, CircleCheck, CirclePause, Clock, Copy, KeyRound, Lock, LogOut, Pencil, Plus, Search, Store, Trash2 } from 'lucide-react';

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

const LogoMark = ({ size = 34 }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true" className="adm-logo">
    <rect width="32" height="32" rx="8" fill="#E3A62B" />
    <rect x="8" y="10" width="16" height="2.5" rx="1.25" fill="#17212B" />
    <rect x="8" y="15" width="16" height="2.5" rx="1.25" fill="#17212B" />
    <rect x="8" y="20" width="10" height="2.5" rx="1.25" fill="#17212B" />
  </svg>
);

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
    <div className="adm-auth">
      <form className="login-card adm-auth-card" onSubmit={submit}>
        <div className="adm-auth-brand"><LogoMark size={44} /><div><strong>Posify</strong><span>Admin console</span></div></div>
        <div className="login-card-header">
          <h2>Welcome back</h2>
          <p>Sign in to manage your client shops</p>
        </div>
        <label className="login-field"><span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus placeholder="admin username" />
        </label>
        <label className="login-field"><span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required placeholder="••••••••" />
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="login-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>
        <p className="adm-auth-foot"><Lock size={13} aria-hidden="true" /> Platform administrators only</p>
      </form>
    </div>
  );
}

function CopyText({ text, label = 'Copy', icon = true }) {
  const toast = useToast();
  return (
    <button type="button" className={`adm-copy${label ? '' : ' icon-only'}`} title={label || 'Copy'} aria-label={label || 'Copy'} onClick={async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed. Select the text and copy it by hand', 'err'); }
    }}>{icon && <Copy size={14} aria-hidden="true" />}{label}</button>
  );
}

// Username + temporary password to hand to a shop owner. Shown until the owner signs in and chooses their own.
function Credentials({ shop }) {
  if (!shop.owner) return <p className="adm-muted">No owner account</p>;
  return (
    <div className="adm-cred">
      <div className="adm-cred-row">
        <span>Username</span><code>{shop.owner.username}</code><CopyText text={shop.owner.username} label="" />
      </div>
      {shop.tempPassword ? (
        <>
          <div className="adm-cred-row">
            <span>Temporary password</span><code>{shop.tempPassword}</code><CopyText text={shop.tempPassword} label="" />
          </div>
          <div className="adm-cred-foot pending">
            <Clock size={14} aria-hidden="true" /><span>Waiting for the owner to sign in and set their own password</span>
            <CopyText text={`Shop: ${shop.name}\nUsername: ${shop.owner.username}\nTemporary password: ${shop.tempPassword}`} label="Copy both" icon={false} />
          </div>
        </>
      ) : (
        <div className="adm-cred-foot done">
          <CircleCheck size={14} aria-hidden="true" /><span>Owner uses their own password{shop.ownerPasswordChangedAt ? ` · since ${dateTime(shop.ownerPasswordChangedAt)}` : ''}</span>
        </div>
      )}
    </div>
  );
}

// Soft, readable avatar colours (identity only), picked from the shop name so a shop keeps its colour.
const AVATARS = ['#2D3F8F', '#1E7B50', '#B45309', '#7C3AED', '#0E7490', '#BE185D'];
const avatarColor = (name) => AVATARS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) % AVATARS.length];
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

const FILTERS = [
  ['all', 'All', Store],
  ['active', 'Active', CircleCheck],
  ['suspended', 'Suspended', CirclePause],
  ['waiting', 'Waiting for owner', Clock],
];
const matches = (s, f) => f === 'all' || (f === 'active' && s.active) || (f === 'suspended' && !s.active) || (f === 'waiting' && Boolean(s.tempPassword));

function ShopCard({ shop, onRename, onReset, onToggle, onClear }) {
  return (
    <article className={`adm-card${shop.active ? '' : ' off'}`}>
      <header>
        <span className="adm-avatar" style={{ background: avatarColor(shop.name) }}>{initials(shop.name)}</span>
        <div className="adm-card-title">
          <h3>{shop.name}</h3>
          <p>{shop.owner ? shop.owner.name : 'No owner'}</p>
        </div>
        <span className={`adm-pill ${shop.active ? 'on' : 'off'}`}>{shop.active ? 'Active' : 'Suspended'}</span>
      </header>
      <Credentials shop={shop} />
      {shop.notes && <p className="adm-notes">{shop.notes}</p>}
      <footer>
        <span className="adm-muted">Created {dateTime(shop.createdAt)}</span>
        <div className="adm-actions">
          <button type="button" onClick={onRename}><Pencil size={14} aria-hidden="true" /> Edit</button>
          <button type="button" onClick={onReset}><KeyRound size={14} aria-hidden="true" /> Reset password</button>
          <button type="button" onClick={onClear}><Trash2 size={14} aria-hidden="true" /> Clear sales</button>
          {shop.active
            ? <button type="button" className="danger" onClick={onToggle}><CirclePause size={14} aria-hidden="true" /> Suspend</button>
            : <button type="button" className="primary" onClick={onToggle}><CircleCheck size={14} aria-hidden="true" /> Reactivate</button>}
        </div>
      </footer>
    </article>
  );
}

function AdminMenu({ admin, onPassword, onOut }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="adm-menu">
      <button type="button" className="adm-me" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="adm-me-avatar">{initials(admin.name)}</span>
        <span className="adm-me-name">{admin.name}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="topbar-backdrop" onClick={() => setOpen(false)} />
          <div className="topbar-dropdown">
            <div className="topbar-dropdown-user">
              <span className="adm-me-avatar lg">{initials(admin.name)}</span>
              <div><div className="topbar-dropdown-name">{admin.name}</div><div className="topbar-dropdown-role">@{admin.username} · Platform admin</div></div>
            </div>
            <hr className="topbar-dropdown-divider" />
            <button className="topbar-dropdown-item" onClick={() => { setOpen(false); onPassword(); }}><KeyRound size={14} aria-hidden="true" /> Change password</button>
            <button className="topbar-dropdown-signout" onClick={() => { setOpen(false); onOut(); }}><LogOut size={14} aria-hidden="true" /> Sign out</button>
          </div>
        </>
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
  const [filter, setFilter] = useState('all');
  const [pw, setPw] = useState(false);
  const [clearing, setClearing] = useState(null);

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

  const list = shops || [];
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, list.filter((s) => matches(s, k)).length]));
  const shown = list.filter((s) => matches(s, filter) && (!q || `${s.name} ${s.owner?.username ?? ''} ${s.owner?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="adm">
      <header className="adm-head">
        <div className="adm-brand"><LogoMark /><strong>Posify</strong><span className="adm-tag">Admin</span></div>
        <AdminMenu admin={admin} onPassword={() => setPw(true)} onOut={onOut} />
      </header>

      <main className="adm-main">
        <section className="adm-hero">
          <div>
            <h1>Client shops</h1>
            <p>Create shops, hand owners their first sign-in, and switch shops off or on.</p>
          </div>
          <button className="primary adm-new" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New shop</button>
        </section>

        <section className="adm-stats" aria-label="Summary">
          {FILTERS.map(([k, label, Icon]) => (
            <button key={k} type="button" className={`adm-stat s-${k}${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>
              <span className="adm-stat-icon"><Icon size={18} aria-hidden="true" /></span>
              <span className="adm-stat-label">{k === 'all' ? 'Total shops' : label}</span>
              <strong>{shops ? counts[k] : '–'}</strong>
            </button>
          ))}
        </section>

        <div className="adm-search">
          <Search size={16} aria-hidden="true" />
          <input placeholder="Search by shop, owner or username" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shops" />
        </div>

        {shops === null ? <div className="adm-grid">{[0, 1, 2].map((i) => <div key={i} className="adm-card skel-card"><span className="skel" style={{ width: '60%' }} /><span className="skel" style={{ width: '90%', marginTop: '1rem' }} /><span className="skel" style={{ width: '40%', marginTop: '.6rem' }} /></div>)}</div>
          : shown.length === 0 ? (
            <div className="adm-empty">
              <Store size={34} aria-hidden="true" />
              <h3>{list.length ? 'No shops match' : 'No shops yet'}</h3>
              <p>{list.length ? 'Try another search or filter.' : 'Create your first client shop to get started.'}</p>
              {!list.length && <button className="primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New shop</button>}
            </div>
          ) : (
            <div className="adm-grid">
              {shown.map((s) => (
                <ShopCard key={s.id} shop={s} onRename={() => setEditing(s)} onReset={() => setConfirm({ shop: s, action: 'reset' })}
                  onToggle={() => setConfirm({ shop: s, action: s.active ? 'suspend' : 'reactivate' })} onClear={() => setClearing(s)} />
              ))}
            </div>
          )}
      </main>

      {creating && <NewShop onClose={() => setCreating(false)} onCreated={(s) => setShops((l) => [s, ...(l || [])])} />}
      {editing && <RenameShop shop={editing} onClose={() => setEditing(null)} onSaved={(s) => { replace(s); setEditing(null); }} />}
      {pw && <AdminPassword onClose={() => setPw(false)} />}
      {clearing && <ClearSales shop={clearing} onClose={() => setClearing(null)} />}
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
        <div className="adm-created"><CircleCheck size={28} aria-hidden="true" /><p>Give these to <strong>{created.owner.name}</strong>. They sign in at the shop's normal web address and will be asked to choose their own password.</p></div>
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

const n = (v, one, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;

// Wipe a shop's test sales (keeps products, customers and users). Shows what will go, then asks for the shop name.
function ClearSales({ shop, onClose }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [restore, setRestore] = useState(true);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    adminApi(`/shops/${shop.id}/sales-data`).then(setInfo).catch((e) => { toast(e.message, 'err'); closeRef.current(); });
  }, [shop.id, toast]);

  const matches = typed.trim().toLowerCase() === shop.name.trim().toLowerCase();
  const submit = async (e) => {
    e.preventDefault(); if (!matches) return;
    setBusy(true);
    try { setDone(await adminApi(`/shops/${shop.id}/clear-sales`, { method: 'POST', body: { confirm: typed, restoreStock: restore } })); toast(`${shop.name}: sales cleared`); }
    catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  if (done) {
    return (
      <Modal title="Sales cleared" onClose={onClose}>
        <div className="adm-created"><CircleCheck size={28} aria-hidden="true" /><p>
          Removed {n(done.sales, 'sale')}, {n(done.refunds, 'refund')}, {n(done.debtPayments, 'debt payment')} and {n(done.shifts, 'shift')}.
          {done.customersReset > 0 && <> {n(done.customersReset, 'customer balance')} set back to 0.</>}
          {done.productsRestocked > 0 && <> {done.piecesRestocked} pieces put back into stock across {n(done.productsRestocked, 'product')}.</>}
          {' '}The next receipt will be R-000001.
        </p></div>
        <p className="hint">Anyone signed in to {shop.name} should refresh the page to see the cleared reports.</p>
        <div className="actions"><button className="primary" onClick={onClose}>Done</button></div>
      </Modal>
    );
  }
  return (
    <Modal title={`Clear sales for ${shop.name}?`} onClose={onClose}>
      {!info ? <p className="hint">Checking what this shop has…</p> : (
        <form onSubmit={submit} className="adm-clear">
          {info.sales + info.refunds + info.debtPayments + info.shifts + info.heldSales + info.customersOwing === 0 && info.stockMoves === 0 ? (
            <p>This shop has no sales data to clear.</p>
          ) : (
            <>
              <p>For shops that tested the till before going live. <strong>This cannot be undone.</strong></p>
              <div className="adm-clear-lists">
                <div>
                  <h4>Removed</h4>
                  <ul>
                    <li>{n(info.sales, 'sale')}{info.firstSale && <span className="adm-muted"> ({dateTime(info.firstSale)} – {dateTime(info.lastSale)})</span>}</li>
                    <li>{n(info.refunds, 'refund')} and {n(info.creditNotes, 'credit note')}</li>
                    <li>{n(info.debtPayments, 'debt payment')}</li>
                    <li>{n(info.shifts, 'shift')} and {n(info.heldSales, 'held sale')}</li>
                    <li>What {n(info.customersOwing, 'customer')} owe{info.customersOwing === 1 ? 's' : ''} (set back to 0)</li>
                    <li>Receipt numbers restart at R-000001</li>
                  </ul>
                </div>
                <div>
                  <h4>Kept</h4>
                  <ul><li>Products and prices</li><li>Customers</li><li>Suppliers and deliveries</li><li>Users and passwords</li></ul>
                </div>
              </div>
              <label className="check adm-clear-stock">
                <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} />
                <span>Put the sold items back into stock{info.stockMoves > 0 && <span className="adm-muted"> ({n(info.stockMoves, 'stock change')} from sales undone)</span>}</span>
              </label>
              <p className="hint">{restore
                ? 'Stock goes back to what it would be if these sales never happened.'
                : 'Untick if the shop has already counted its stock after testing: stock stays as it is now.'}</p>
              <Field label={<>Type <strong>{shop.name}</strong> to confirm</>}>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
              </Field>
            </>
          )}
          <div className="actions">
            <button type="button" onClick={onClose}>Cancel</button>
            {info.sales + info.refunds + info.debtPayments + info.shifts + info.heldSales + info.customersOwing + info.stockMoves > 0 && (
              <button className="danger" disabled={!matches || busy}>{busy ? 'Clearing…' : 'Clear sales data'}</button>
            )}
          </div>
        </form>
      )}
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
