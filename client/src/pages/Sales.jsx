import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import Receipt from '../Receipt.jsx';
import DataTable from '../DataTable.jsx';
import { dateTime, fmt, qtyFmt, todayStr, r2 } from '../format.js';

const PAGE_SIZE = 200;
const METHODS = ['Cash', 'MoMo', 'Card', 'Transfer'];
const STATUS_LABEL = { completed: 'Completed', voided: 'Voided', 'partial-return': 'Part. return' };
const STATUS_CLASS = { completed: 'badge-green', voided: 'badge-red', 'partial-return': 'badge-amber' };

export default function Sales() {
  const { isOwner } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [sales, setSales] = useState(() => cacheGet(`/sales?from=${todayStr()}&to=${todayStr()}`)); // warm copy from the background prefetch
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [returning, setReturning] = useState(null);
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('Cash');

  const load = useCallback(() => {
    swrFetch(`/sales?from=${from}&to=${to}`, { onData: setSales, onRefreshing: setRefreshing, ttlMs: 20_000 })
      .catch((e) => toast(e.message, 'err'));
  }, [from, to, toast]);
  useEffect(() => { load(); }, [load]);

  // The server returns 200 sales per page; a full page means there may be more.
  const hasMore = sales !== null && sales.length > 0 && sales.length % PAGE_SIZE === 0;
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const more = await api(`/sales?from=${from}&to=${to}&skip=${sales.length}`);
      setSales((cur) => [...cur, ...more.filter((m) => !cur.some((c) => c._id === m._id))]);
    } catch (e) { toast(e.message, 'err'); }
    setLoadingMore(false);
  };

  const doVoid = async () => {
    try {
      const r = await api(`/sales/${voiding._id}/void`, { method: 'POST', body: { reason, refundMethod } });
      toast(`${voiding.receiptNo} voided and stock restored${refundNote(r)}`);
      cacheInvalidatePrefix('/products'); cacheInvalidatePrefix('/sales'); cacheInvalidatePrefix('/customers'); cacheInvalidatePrefix('/reports');
      setVoiding(null); setReason(''); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const completed = (sales || []).filter((s) => s.status === 'completed' || s.status === 'partial-return');
  const totalRevenue = r2(completed.reduce((s, x) => s + x.total, 0));
  const totalCredit = r2(completed.reduce((s, x) => s + (x.balance || 0), 0));
  const cashiers = [...new Set((sales || []).map((s) => s.cashier?.name).filter(Boolean))].sort();
  const open = (s) => s.status === 'completed' || s.status === 'partial-return';
  const methodsOf = (s) => (s.payments || []).map((p) => p.method);

  const columns = [
    { key: 'receiptNo', label: 'Receipt', render: (s) => <span className="receipt-no">{s.receiptNo}</span> },
    { key: 'createdAt', kind: 'date', label: 'Time', className: 'muted-cell nowrap', render: (s) => dateTime(s.createdAt), exportValue: (s) => dateTime(s.createdAt) },
    { key: 'cashier', label: 'Cashier', value: (s) => s.cashier?.name || '', render: (s) => s.cashier?.name || '' },
    { key: 'customer', label: 'Customer', value: (s) => s.customerName || '', render: (s) => s.customerName || <span className="muted-cell">Walk-in</span>, exportValue: (s) => s.customerName || 'Walk-in' },
    { key: 'paid', label: 'Paid by', value: (s) => methodsOf(s).join(', '), render: (s) => methodsOf(s).join(', ') || <span className="muted-cell">Credit</span> },
    { key: 'total', label: 'Total', align: 'num', render: (s) => <strong>{fmt(s.total)}</strong> },
    { key: 'balance', label: 'Credit', align: 'num', value: (s) => s.balance || 0, render: (s) => (s.balance > 0 ? <span className="owes">{fmt(s.balance)}</span> : <span className="muted-cell">–</span>) },
    { key: 'status', label: 'Status', value: (s) => STATUS_LABEL[s.status] || s.status, render: (s) => <span className={`badge ${STATUS_CLASS[s.status] || ''}`}>{STATUS_LABEL[s.status] || s.status}</span> },
    ...(isOwner ? [{ key: 'acts', label: '', sortable: false, export: false, render: (s) => (open(s) ? (
      <div className="cell-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setReturning(s)}>Return</button>
        <button className="danger" onClick={() => { setVoiding(s); setReason(''); }}>Void</button>
      </div>
    ) : null) }] : []),
  ];
  const filters = [
    { key: 'status', label: 'All statuses', options: Object.entries(STATUS_LABEL), test: (s, v) => s.status === v },
    { key: 'method', label: 'Any payment', options: [...METHODS.map((m) => [m, m]), ['credit', 'On credit']], test: (s, v) => (v === 'credit' ? s.balance > 0 : methodsOf(s).includes(v)) },
    ...(cashiers.length > 1 ? [{ key: 'cashier', label: 'All cashiers', options: cashiers.map((c) => [c, c]), test: (s, v) => s.cashier?.name === v }] : []),
  ];

  return (
    <div className="page">
      <RefreshIndicator refreshing={refreshing} />
      <div className="stat-row">
        <div className="stat-chip"><span>Sales</span><strong>{completed.length}</strong></div>
        <div className="stat-chip key"><span>Revenue</span><strong>{fmt(totalRevenue)}</strong></div>
        {totalCredit > 0 && <div className="stat-chip warn"><span>On credit</span><strong>{fmt(totalCredit)}</strong></div>}
        {sales && sales.length !== completed.length && <div className="stat-chip"><span>Voided</span><strong>{sales.length - completed.length}</strong></div>}
      </div>

      {sales === null ? <TableSkeleton cols={7} rows={8} /> : (
        <DataTable
          title="Sales" exportName="sales" rows={sales} columns={columns} filters={filters}
          searchPlaceholder="Search receipt, customer, cashier"
          initialSort={{ key: 'createdAt', dir: 'desc' }}
          onRowClick={setView} rowClass={(s) => (s.status === 'voided' ? 'voided' : '')}
          emptyText="No sales in this period."
          toolbar={(
            <div className="dt-dates">
              <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" />
              <span>to</span>
              <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To" />
            </div>
          )}
        />
      )}

      {hasMore && (
        <div className="actions" style={{ justifyContent: 'center' }}>
          <button onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : `Load more (showing ${sales.length})`}</button>
        </div>
      )}

      {/* View receipt modal */}
      {view && (
        <Modal title={view.receiptNo} onClose={() => setView(null)}>
          <Receipt sale={view} />
          <div className="actions">
            <button className="primary" onClick={() => window.print()}>Print receipt</button>
            {isOwner && (view.status === 'completed' || view.status === 'partial-return') && (
              <button className="danger" onClick={() => { setVoiding(view); setView(null); setReason(''); }}>Void</button>
            )}
            {isOwner && (view.status === 'completed' || view.status === 'partial-return') && (
              <button onClick={() => { setReturning(view); setView(null); }}>Return items</button>
            )}
          </div>
        </Modal>
      )}

      {/* Void modal */}
      {voiding && (
        <Modal title={`Void ${voiding.receiptNo}`} onClose={() => setVoiding(null)}>
          <p>This returns all items to stock and cancels the sale of <strong>{fmt(voiding.total)}</strong>. It cannot be undone.</p>
          <Field label="Reason">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer returned everything" />
          </Field>
          <RefundMethod value={refundMethod} onChange={setRefundMethod} />
          <div className="actions">
            <button className="danger" disabled={reason.trim().length < 3} onClick={doVoid}>Void sale</button>
          </div>
        </Modal>
      )}

      {returning && (
        <ReturnModal sale={returning} onClose={() => setReturning(null)} onSaved={() => { setReturning(null); load(); }} />
      )}
    </div>
  );
}

const refundNote = (r) => [
  r?.refundAmount > 0 ? ` · refund ${fmt(r.refundAmount)} (${r.refundMethod})` : '',
  r?.creditReduced > 0 ? ` · ${fmt(r.creditReduced)} taken off the customer's balance` : '',
].join('');

function RefundMethod({ value, onChange }) {
  return (
    <Field label="Refund paid out as" hint="Used for any money handed back. Amounts owed on credit are cancelled first.">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {METHODS.map((m) => <option key={m}>{m}</option>)}
      </select>
    </Field>
  );
}

function ReturnModal({ sale, onClose, onSaved }) {
  const toast = useToast();
  const [qtys, setQtys] = useState(() => Object.fromEntries(sale.items.map((_, i) => [i, ''])));
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('Cash');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const lines = sale.items
      .map((it, i) => ({ productId: String(it.product), qty: Number(qtys[i]) || 0 }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) return toast('Enter a quantity to return for at least one item', 'err');
    setBusy(true);
    try {
      const r = await api(`/sales/${sale._id}/return`, { method: 'POST', body: { lines, reason, refundMethod } });
      toast(`Return recorded and stock restored${refundNote(r)}`);
      cacheInvalidatePrefix('/products'); cacheInvalidatePrefix('/sales'); cacheInvalidatePrefix('/customers'); cacheInvalidatePrefix('/reports');
      onSaved();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  return (
    <Modal title={`Return items — ${sale.receiptNo}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Product</th><th className="num">Sold</th><th className="num">Returned</th><th className="num">Return qty</th></tr>
            </thead>
            <tbody>
              {sale.items.map((it, i) => {
                const remaining = it.qty - (it.returnedQty || 0);
                return (
                  <tr key={i}>
                    <td>{it.name}</td>
                    <td className="num">{qtyFmt(it.qty)}</td>
                    <td className="num">{it.returnedQty > 0 ? <span className="owes">{qtyFmt(it.returnedQty)}</span> : '–'}</td>
                    <td className="num">
                      <input type="number" min="0" max={remaining} step="any"
                        value={qtys[i]} onChange={(e) => setQtys({ ...qtys, [i]: e.target.value })}
                        disabled={remaining <= 0} className="qty-input" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Field label="Reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged goods" required minLength={3} />
        </Field>
        <RefundMethod value={refundMethod} onChange={setRefundMethod} />
        <div className="actions"><button className="primary" disabled={busy}>Record return</button></div>
      </form>
    </Modal>
  );
}
