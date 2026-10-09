import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, useToast } from '../ui.jsx';

const ROLE_CLASS = { owner: 'badge-green', cashier: 'badge-amber' };

function EyeIcon({ open }) {
  return open
    ? <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="10" cy="10" r="2.5"/></svg>
    : <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="10" cy="10" r="2.5"/><line x1="2" y1="2" x2="18" y2="18"/></svg>;
}

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);

  const load = useCallback(() => { api('/users').then(setList).catch((e) => toast(e.message, 'err')); }, [toast]);
  useEffect(load, [load]);

  const toggle = async (u) => {
    try { await api(`/users/${u._id}`, { method: 'PATCH', body: { active: !u.active } }); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const owners = list.filter((u) => u.role === 'owner').length;
  const cashiers = list.filter((u) => u.role === 'cashier').length;
  const disabled = list.filter((u) => !u.active).length;

  return (
    <div className="page">
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          {owners > 0 && <span className="chip chip-green">{owners} owner{owners !== 1 ? 's' : ''}</span>}
          {cashiers > 0 && <span className="chip">{cashiers} cashier{cashiers !== 1 ? 's' : ''}</span>}
          {disabled > 0 && <span className="chip chip-red">{disabled} disabled</span>}
        </div>
        <button className="primary" onClick={() => setEdit({ name: '', username: '', role: 'cashier' })}>Add user</button>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u._id} className={u.active ? '' : 'voided'}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <div className="user-avatar-sm">{u.name.charAt(0).toUpperCase()}</div>
                    <strong>{u.name}</strong>
                    {u._id === me._id && <span className="chip chip-muted">You</span>}
                  </div>
                </td>
                <td className="muted-cell">@{u.username}</td>
                <td><span className={`badge ${ROLE_CLASS[u.role]}`}>{u.role === 'owner' ? 'Owner' : 'Cashier'}</span></td>
                <td>{u.active ? <span className="badge badge-green">Active</span> : <span className="badge badge-red">Disabled</span>}</td>
                <td className="acts">
                  <button onClick={() => setEdit(u)}>Edit</button>
                  {u._id !== me._id && (
                    <button className={u.active ? 'danger' : ''} onClick={() => toggle(u)}>
                      {u.active ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="5" className="empty">No users found.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <UserForm
          u={edit}
          self={edit._id === me._id}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
    </div>
  );
}

function UserForm({ u, self, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !u._id;
  const [f, setF] = useState({ name: u.name, username: u.username, role: u.role, password: '' });
  const [showPw, setShowPw] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const body = isNew ? f : { name: f.name, role: f.role, ...(f.password ? { password: f.password } : {}) };
    try { await api(isNew ? '/users' : `/users/${u._id}`, { method: isNew ? 'POST' : 'PATCH', body }); toast('User saved'); onSaved(); }
    catch (err) { toast(err.message, 'err'); }
  };
  return (
    <Modal title={isNew ? 'Add user' : `Edit ${u.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Username">
          <input value={f.username} onChange={set('username')} disabled={!isNew} required minLength={3} autoComplete="off" />
        </Field>
        <Field label="Role" hint="Cashiers can sell and see their own sales. They can't see costs, reports or edit products.">
          <select value={f.role} onChange={set('role')} disabled={self}>
            <option value="cashier">Cashier</option>
            <option value="owner">Owner</option>
          </select>
        </Field>
        <Field label={isNew ? 'Password' : 'New password (leave blank to keep)'} hint="At least 8 characters">
          <div className="pw-wrap">
            <input type={showPw ? 'text' : 'password'} value={f.password} onChange={set('password')} required={isNew} minLength={8} autoComplete="new-password" />
            <button type="button" className="pw-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
              <EyeIcon open={showPw} />
            </button>
          </div>
        </Field>
        <div className="actions"><button className="primary">Save user</button></div>
      </form>
    </Modal>
  );
}
