import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { swrFetch } from '../cache.js';
import { Field, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import { dateTime, todayStr } from '../format.js';

const ACTION_FILTERS = [
  ['', 'All actions'],
  ['login', 'Logins'],
  ['user', 'User changes'],
  ['product.price', 'Price edits'],
  ['product', 'Product changes'],
];

const actionClass = (action) => {
  if (action === 'login.ok') return 'badge-green';
  if (action.startsWith('login.fail')) return 'badge-red';
  if (action.includes('create')) return 'badge-green';
  if (action.includes('delete')) return 'badge-red';
  if (action.includes('price') || action.includes('update')) return 'badge-amber';
  return '';
};

export default function AuditLog() {
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [action, setAction] = useState('');
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(() => {
    const key = `/audit?from=${from}&to=${to}${action ? `&action=${encodeURIComponent(action)}` : ''}`;
    swrFetch(key, { onData: setRows, onRefreshing: setRefreshing, ttlMs: 20_000 })
      .catch((e) => { if (rows === null) toast(e.message, 'err'); });
  }, [from, to, action, toast]);

  useEffect(() => { load(); }, [load]);

  if (rows === null) return <div className="page"><div className="sales-topbar" /><TableSkeleton cols={6} rows={10} /></div>;

  const failures = rows.filter((r) => r.action.startsWith('login.fail')).length;

  return (
    <div className="page">
      <RefreshIndicator refreshing={refreshing} />
      <div className="sales-topbar">
        <div className="filters">
          <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Action">
            <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 'auto' }}>
              {ACTION_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        {rows.length > 0 && (
          <div className="sales-summary">
            <div className="sales-stat"><span>Entries</span><strong>{rows.length}</strong></div>
            {failures > 0 && <div className="sales-stat warn"><span>Failed logins</span><strong>{failures}</strong></div>}
          </div>
        )}
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>IP</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <>
                <tr
                  key={r._id}
                  className={r.action.startsWith('login.fail') ? 'voided' : ''}
                  style={{ cursor: r.detail ? 'pointer' : 'default' }}
                  onClick={() => r.detail && setExpanded(expanded === r._id ? null : r._id)}
                >
                  <td className="muted-cell">{dateTime(r.createdAt)}</td>
                  <td><strong>{r.user?.name ?? r.username ?? '–'}</strong></td>
                  <td><span className={`badge ${actionClass(r.action)}`}>{r.action}</span></td>
                  <td className="muted-cell">{r.target ?? '–'}</td>
                  <td className="muted-cell"><small>{r.ip ?? '–'}</small></td>
                  <td>{r.detail && <span className="muted-cell" style={{ fontSize: '.8rem' }}>{expanded === r._id ? '▲' : '▼'}</span>}</td>
                </tr>
                {expanded === r._id && r.detail && (
                  <tr key={`${r._id}-d`}>
                    <td colSpan="6" style={{ padding: 0 }}>
                      <pre className="audit-detail">{JSON.stringify(r.detail, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {rows.length === 0 && <tr><td colSpan="6" className="empty">No audit entries in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
