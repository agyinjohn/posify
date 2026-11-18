import { useCallback, useEffect, useState } from 'react';
import { swrFetch, cacheGet } from '../cache.js';
import { Field, Modal, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import DataTable from '../DataTable.jsx';
import { dateTime, todayStr } from '../format.js';

// Filters match the start of the action name (the server does a prefix match).
const ACTION_FILTERS = [
  ['', 'All actions'],
  ['sale', 'Sales, voids and returns'],
  ['stock', 'Stock received, adjusted, counted'],
  ['product', 'Products and prices'],
  ['customer', 'Customers and payments'],
  ['supplier', 'Suppliers'],
  ['po', 'Purchase orders'],
  ['shift', 'Shifts'],
  ['user', 'Staff accounts'],
  ['login', 'Sign-ins'],
  ['password', 'Passwords'],
  ['platform', 'Changes by your provider'],
];

// Plain words for each action; anything new falls back to its code.
const LABELS = {
  'sale.create': 'Sale', 'sale.void': 'Sale voided', 'sale.return': 'Items returned',
  'stock.receive': 'Stock received', 'stock.adjust': 'Stock adjusted', stocktake: 'Stock take',
  'product.create': 'Product added', 'product.edit': 'Product edited', 'product.price': 'Price changed', 'product.delete': 'Product hidden', 'product.import': 'Products imported',
  'customer.create': 'Customer added', 'customer.edit': 'Customer edited', 'customer.payment': 'Debt payment',
  'supplier.create': 'Supplier added', 'supplier.edit': 'Supplier edited',
  'po.create': 'Purchase order', 'po.order': 'Order sent', 'po.receive': 'Order received',
  'shift.open': 'Shift opened', 'shift.close': 'Shift closed',
  'user.create': 'Staff added', 'user.edit': 'Staff edited', 'user.password.reset': 'Staff password reset',
  'login.success': 'Signed in', 'login.fail': 'Failed sign-in',
  'password.change': 'Password changed', 'password.change.fail': 'Wrong current password',
  'recovery.generate': 'Recovery codes made', 'recovery.generate.fail': 'Recovery codes refused', 'recovery.reset': 'Password reset with code', 'recovery.fail': 'Recovery code refused',
  'platform.shop.create': 'Shop created', 'platform.shop.edit': 'Shop details changed', 'platform.shop.suspend': 'Shop suspended',
  'platform.shop.reactivate': 'Shop reactivated', 'platform.owner.reset': 'Owner password reset', 'platform.sales.clear': 'Sales data cleared',
};
const label = (a) => LABELS[a] || a;
const tone = (a) => {
  if (a.endsWith('.fail') || a.includes('void') || a.includes('delete') || a.includes('suspend') || a.includes('clear')) return 'badge-red';
  if (a.includes('price') || a.includes('adjust') || a.includes('return') || a.includes('reset')) return 'badge-amber';
  if (a.includes('create') || a === 'login.success' || a.includes('receive') || a.includes('payment')) return 'badge-green';
  return 'badge-plain';
};
// One readable line from the details (the full details open on click).
const COLUMNS = [
  { key: 'createdAt', kind: 'date', label: 'When', className: 'muted-cell nowrap', render: (r) => dateTime(r.createdAt), exportValue: (r) => dateTime(r.createdAt) },
  { key: 'who', label: 'Who', value: (r) => r.user?.name ?? r.username ?? '', render: (r) => <strong>{r.user?.name ?? r.username ?? '–'}</strong> },
  { key: 'action', label: 'What', value: (r) => label(r.action), render: (r) => <span className={`badge ${tone(r.action)}`}>{label(r.action)}</span> },
  { key: 'target', label: 'On', render: (r) => r.target ?? <span className="muted-cell">–</span> },
  { key: 'details', label: 'Details', value: (r) => summary(r), sortable: false, className: 'muted-cell audit-sum', render: (r) => summary(r) || '' },
  { key: 'ip', label: 'IP', hidden: true },
];

const summary = (r) => {
  const d = r.detail;
  if (!d || typeof d !== 'object') return '';
  const parts = Object.entries(d).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object').slice(0, 4)
    .map(([k, v]) => `${k}: ${v}`);
  return parts.join(' · ');
};

export default function AuditLog() {
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [action, setAction] = useState('');
  const keyOf = (f, t, a) => `/audit?from=${f}&to=${t}${a ? `&action=${encodeURIComponent(a)}` : ''}`;
  const [rows, setRows] = useState(() => cacheGet(keyOf(todayStr(), todayStr(), '')) ?? undefined);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(() => {
    const key = keyOf(from, to, action);
    setError('');
    setRows((cur) => cacheGet(key) ?? cur);
    swrFetch(key, { onData: (r) => { setRows(r); setError(''); }, onRefreshing: setRefreshing, ttlMs: 20_000 })
      .catch((e) => { setError(e.message || 'Could not load the audit log'); toast(e.message, 'err'); setRows((cur) => cur ?? []); });
  }, [from, to, action, toast]);
  useEffect(() => { load(); }, [load]);

  const list = rows ?? [];
  const failures = list.filter((r) => r.action === 'login.fail').length;

  return (
    <div className="page">
      <RefreshIndicator refreshing={refreshing} />
      <div className="sales-topbar">
        <div className="filters">
          <Field label="From"><input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} min={from} max={todayStr()} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
          <Field label="What">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTION_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        {list.length > 0 && (
          <div className="sales-summary">
            <div className="sales-stat"><span>Entries</span><strong>{list.length}{list.length >= 500 ? '+' : ''}</strong></div>
            {failures > 0 && <div className="sales-stat warn"><span>Failed sign-ins</span><strong>{failures}</strong></div>}
          </div>
        )}
      </div>

      {error && (
        <div className="audit-error" role="alert">
          <span>Could not load the audit log: {error}</span>
          <button onClick={load}>Try again</button>
        </div>
      )}

      {rows === undefined ? <TableSkeleton cols={5} rows={10} /> : (
        <DataTable title="Audit log" exportName="audit-log" rows={list} columns={COLUMNS} searchPlaceholder="Search person, action or item"
          initialSort={{ key: 'createdAt', dir: 'desc' }} onRowClick={(r) => r.detail && setExpanded(r)}
          rowClass={(r) => (r.action === 'login.fail' ? 'voided' : '')} emptyText="Nothing was recorded in this period." />
      )}
      {expanded && (
        <Modal title={label(expanded.action)} onClose={() => setExpanded(null)}>
          <p className="hint">{dateTime(expanded.createdAt)} · {expanded.user?.name ?? expanded.username ?? '–'}{expanded.target ? ` · ${expanded.target}` : ''}{expanded.ip ? ` · from ${expanded.ip}` : ''}</p>
          <pre className="audit-detail">{JSON.stringify(expanded.detail, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}
