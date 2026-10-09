import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, useToast } from '../ui.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);

  const load = useCallback(() => { api('/users').then(setList).catch((e) => toast(e.message, 'err')); }, [toast]);
  useEffect(load, [load]);

  const toggle = async (u) => {
    try { await api(`/users/${u._id}`, { method: 'PATCH', body: { active: !u.active } }); load(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="head"><h1>Users</h1><button className="primary" onClick={() => setEdit({ name: '', username: '', role: 'cashier' })}>Add user</button></div>
      <div className="tablewrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.map((u) => (
            <tr key={u._id} className={u.active ? '' : 'voided'}><td>{u.name}</td><td>{u.username}</td><td>{u.role === 'owner' ? 'Owner' : 'Cashier'}</td><td>{u.active ? 'Active' : 'Disabled'}</td>
              <td className="acts"><button onClick={() => setEdit(u)}>Edit</button>
                {u._id !== me._id && <button className={u.active ? 'danger' : ''} onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button>}</td></tr>
          ))}
        </tbody>
      </table></div>
      {edit && <UserForm u={edit} self={edit._id === me._id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function UserForm({ u, self, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !u._id;
  const [f, setF] = useState({ name: u.name, username: u.username, role: u.role, password: '' });
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
        <Field label="Username"><input value={f.username} onChange={set('username')} disabled={!isNew} required minLength={3} autoComplete="off" /></Field>
        <Field label="Role" hint="Cashiers can sell and see their own sales. They can't see costs, reports or edit products.">
          <select value={f.role} onChange={set('role')} disabled={self}><option value="cashier">Cashier</option><option value="owner">Owner</option></select></Field>
        <Field label={isNew ? 'Password' : 'New password (leave blank to keep)'} hint="At least 8 characters">
          <input type="password" value={f.password} onChange={set('password')} required={isNew} minLength={8} autoComplete="new-password" /></Field>
        <div className="actions"><button className="primary">Save user</button></div>
      </form>
    </Modal>
  );
}
