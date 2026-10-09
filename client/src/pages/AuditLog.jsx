import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, useToast } from '../ui.jsx';
import { dateTime, todayStr } from '../format.js';

const ACTION_FILTERS = [
  ['', 'All'],
  ['login', 'Logins'],
  ['user', 'User changes'],
  ['product.price', 'Price edits'],
  ['product', 'Product changes'],
];

export default function AuditLog() {
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [action, setAction] = useState('');
  const [rows, setRows] = useState([]);

  const load = useCallback(() => {
    api(`/audit?from=${from}&to=${to}${action ? `&action=${encodeURIComponent(action)}` : ''}`)
      .then(setRows)
      .catch((e) => toast(e.message, 'err'));
  }, [from, to, action, toast]);

  useEffect(load, [load]);

  return (
    <div className="page">
      <h1>Audit Log</h1>
      <div className="filters">
        <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Filter">
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTION_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id} className={r.action.startsWith('login.fail') ? 'voided' : ''}>
              <td>{dateTime(r.createdAt)}</td>
              <td>{r.user?.name ?? r.username ?? '—'}</td>
              <td>{r.action}</td>
              <td>{r.target ?? '—'}</td>
              <td><small>{r.detail ? JSON.stringify(r.detail) : '—'}</small></td>
              <td><small>{r.ip ?? '—'}</small></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="6" className="empty">No audit entries in this period.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
