import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import DataTable from '../DataTable.jsx';
import { METHODS, dateTime, fmt, r2, todayStr } from '../format.js';

/**
 * Expenses: rent, wages, transport, light bill... Owners record, correct and delete them; cashiers can record
 * cash they pay out of the till (and see their own). Net profit in Reports = gross profit − expenses.
 */
export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries and wages', 'Transport and fuel', 'Electricity and water', 'Airtime and data', 'Shop supplies',
  'Repairs and maintenance', 'Taxes and levies', 'Bank and MoMo charges', 'Marketing', 'Security', 'Other',
];
const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const monthStart = () => `${todayStr().slice(0, 8)}01`;
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function Expenses() {
  const { isOwner } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  const key = `/expenses?from=${from}&to=${to}`;
  const [list, setList] = useState(() => cacheGet(key) ?? undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = useCallback(() => {
    swrFetch(key, { onData: setList, onRefreshing: setRefreshing, ttlMs: 30_000 })
      .catch((e) => { toast(e.message, 'err'); setList((l) => l ?? []); });
  }, [key, toast]);
  useEffect(() => { load(); }, [load]);

  const all = list || [];
  const total = r2(all.reduce((t, e) => t + e.amount, 0));
  const fromTill = r2(all.filter((e) => e.fromTill).reduce((t, e) => t + e.amount, 0));
  const cats = new Map(); all.forEach((e) => cats.set(e.category, r2((cats.get(e.category) || 0) + e.amount)));
  const top = [...cats].sort((a, b) => b[1] - a[1])[0];

  const columns = [
    { key: 'date', label: 'Date', kind: 'date', className: 'nowrap', render: (e) => day(e.date), exportValue: (e) => iso(e.date) },
    { key: 'category', label: 'For', render: (e) => <strong>{e.category}</strong> },
    { key: 'paidTo', label: 'Paid to', render: (e) => e.paidTo || <span className="muted-cell">–</span> },
    { key: 'method', label: 'Paid by', render: (e) => <>{e.method}{e.fromTill && <span className="badge badge-amber exp-till">from till</span>}</>, exportValue: (e) => `${e.method}${e.fromTill ? ' (from till)' : ''}` },
    { key: 'note', label: 'Note', className: 'muted-cell', render: (e) => e.note || '–' },
    { key: 'user', label: 'By', className: 'muted-cell', value: (e) => e.user?.name || '' },
    { key: 'amount', label: 'Amount', align: 'num', render: (e) => <strong>{fmt(e.amount)}</strong> },
  ];
  const filters = [
    { key: 'category', label: 'All kinds', options: [...cats.keys()].sort().map((c) => [c, c]), test: (e, v) => e.category === v },
    { key: 'method', label: 'Any payment', options: [...METHODS.map((m) => [m, m]), ['till', 'From the till']], test: (e, v) => (v === 'till' ? e.fromTill : e.method === v) },
  ];

  return (
    <div className="page page-wide">
      <RefreshIndicator refreshing={refreshing} />
      <div className="stat-row">
        <div className="stat-chip key"><span>Spent in this period</span><strong>{fmt(total)}</strong></div>
        <div className="stat-chip"><span>Expenses</span><strong>{all.length}</strong></div>
        {top && <div className="stat-chip"><span>Biggest: {top[0]}</span><strong>{fmt(top[1])}</strong></div>}
        {fromTill > 0 && <div className="stat-chip warn"><span>Cash from the till</span><strong>{fmt(fromTill)}</strong></div>}
      </div>
      {list === undefined ? <TableSkeleton cols={6} rows={8} /> : (
        <DataTable
          title="Expenses" exportName="expenses" rows={all} columns={columns} filters={filters}
          searchPlaceholder="Search what, who or note" initialSort={{ key: 'date', dir: 'desc' }}
          onRowClick={isOwner ? setEdit : undefined}
          emptyText={isOwner ? 'No expenses in this period. Add rent, wages, transport and other running costs here.' : 'You have not recorded any expenses in this period.'}
          toolbar={(
            <div className="dt-dates">
              <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" />
              <span>to</span>
              <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To" />
            </div>
          )}
          actions={<button className="primary" onClick={() => setEdit({})}>Add expense</button>}
        />
      )}
      {!isOwner && <p className="hint" style={{ marginTop: '.6rem' }}>Expenses you record here are cash taken from the till today. Ask the owner to correct a mistake.</p>}
      {edit && <ExpenseForm e={edit} isOwner={isOwner} known={[...cats.keys()]} onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); ['/expenses', '/reports', '/shifts'].forEach(cacheInvalidatePrefix); load(); }} />}
    </div>
  );
}

function ExpenseForm({ e, isOwner, known, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !e._id;
  const [f, setF] = useState(() => ({
    date: e.date ? iso(e.date) : todayStr(), category: e.category || '', amount: e.amount ?? '', method: e.method || 'Cash',
    fromTill: e.fromTill ?? true, paidTo: e.paidTo || '', note: e.note || '',
  }));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k) => (ev) => setF((x) => ({ ...x, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value }));
  const suggestions = [...new Set([...EXPENSE_CATEGORIES, ...known])];

  const save = async (ev) => {
    ev.preventDefault(); setBusy(true);
    try {
      const body = { ...f, amount: Number(f.amount), fromTill: f.method === 'Cash' && f.fromTill };
      await api(isNew ? '/expenses' : `/expenses/${e._id}`, { method: isNew ? 'POST' : 'PATCH', body });
      toast(isNew ? 'Expense recorded' : 'Expense updated'); onSaved();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  const remove = async () => {
    try { await api(`/expenses/${e._id}`, { method: 'DELETE' }); toast('Expense deleted'); onSaved(); }
    catch (err) { toast(err.message, 'err'); }
  };

  return (
    <Modal title={isNew ? 'Add expense' : 'Edit expense'} onClose={onClose}>
      <form onSubmit={save} className="grid2">
        <Field label="What was it for?">
          <input value={f.category} onChange={set('category')} list="expense-cats" required maxLength={40} placeholder="e.g. Transport and fuel" autoComplete="off" />
          <datalist id="expense-cats">{suggestions.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Amount (GH₵)"><input type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} required /></Field>
        <Field label="Paid by">
          <select value={f.method} onChange={set('method')}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </Field>
        {isOwner && <Field label="Date paid"><input type="date" value={f.date} max={iso(Date.now() + DAY)} onChange={set('date')} required /></Field>}
        <Field label="Paid to (optional)"><input value={f.paidTo} onChange={set('paidTo')} maxLength={80} placeholder="e.g. Landlord, ECG, driver" /></Field>
        <Field label="Note (optional)"><input value={f.note} onChange={set('note')} maxLength={200} /></Field>
        {f.method === 'Cash' && isOwner && (
          <label className="check span2 exp-till-check">
            <input type="checkbox" checked={f.fromTill} onChange={set('fromTill')} />
            <span>Taken from the till <small>(the shift cash-up will expect this much less cash)</small></span>
          </label>
        )}
        <div className="actions span2">
          {!isNew && (confirmDelete
            ? <><span className="hint">Delete this expense?</span><button type="button" className="danger" onClick={remove}>Yes, delete</button><button type="button" onClick={() => setConfirmDelete(false)}>No</button></>
            : <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>Delete</button>)}
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add expense' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
