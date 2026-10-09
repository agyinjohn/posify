import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { swrFetch } from '../cache.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import Receipt from '../Receipt.jsx';
import { dateTime, fmt, qtyFmt, todayStr, r2 } from '../format.js';

const STATUS_LABEL = { completed: 'Completed', voided: 'Voided', 'partial-return': 'Part. return' };
const STATUS_CLASS = { completed: 'badge-green', voided: 'badge-red', 'partial-return': 'badge-amber' };

export default function Sales() {
  const { isOwner } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [sales, setSales] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [returning, setReturning] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    swrFetch(`/sales?from=${from}&to=${to}`, { onData: setSales, onRefreshing: setRefreshing, ttlMs: 20_000 })
      .catch((e) => toast(e.message, 'err'));
  }, [from, to, toast]);
  useEffect(() => { load(); }, [load]);

  const doVoid = async () => {
    try {
      await api(`/sales/${voiding._id}/void`, { method: 'POST', body: { reason } });
      toast(`${voiding.receiptNo} voided and stock restored`);
      setVoiding(null); setReason(''); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  if (sales === null) return <div className="page"><div className="sales-topbar" /><TableSkeleton cols={7} rows={8} /></div>;

  const completed = sales.filter((s) => s.status === 'completed' || s.status === 'partial-return');
  const totalRevenue = r2(completed.reduce((s, x) => s + x.total, 0));
  const totalCredit = r2(completed.reduce((s, x) => s + (x.balance || 0), 0));

  return (
    <div className="page">
      <RefreshIndicator refreshing={refreshing} />
      {/* Filters + summary in one bar */}
      <div className="sales-topbar">
        <div className="filters">
          <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {sales.length > 0 && (
          <div className="sales-summary">
            <div className="sales-stat"><span>Sales</span><strong>{completed.length}</strong></div>
            <div className="sales-stat key"><span>Revenue</span><strong>{fmt(totalRevenue)}</strong></div>
            {totalCredit > 0 && <div className="sales-stat warn"><span>On credit</span><strong>{fmt(totalCredit)}</strong></div>}
            {sales.length !== completed.length && <div className="sales-stat"><span>Voided</span><strong>{sales.length - completed.length}</strong></div>}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="tablewrap">
        <table className="sales-table">
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Time</th>
              <th>Cashier</th>
              <th>Customer</th>
              <th className="num">Total</th>
              <th className="num">Credit</th>
              <th>Status</th>
              {isOwner && <th></th>}
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s._id} className={s.status === 'voided' ? 'voided' : ''} onClick={() => setView(s)} style={{ cursor: 'pointer' }}>
                <td><span className="receipt-no">{s.receiptNo}</span></td>
                <td className="muted-cell">{dateTime(s.createdAt)}</td>
                <td>{s.cashier?.name}</td>
                <td>{s.customerName || <span className="muted-cell">Walk-in</span>}</td>
                <td className="num"><strong>{fmt(s.total)}</strong></td>
                <td className="num">{s.balance > 0 ? <span className="owes">{fmt(s.balance)}</span> : <span className="muted-cell">–</span>}</td>
                <td><span className={`badge ${STATUS_CLASS[s.status] || ''}`}>{STATUS_LABEL[s.status] || s.status}</span></td>
                {isOwner && (
                  <td className="acts" onClick={(e) => e.stopPropagation()}>
                    {s.status === 'completed' && (
                      <button className="danger" onClick={() => { setVoiding(s); setReason(''); }}>Void</button>
                    )}
                    {(s.status === 'completed' || s.status === 'partial-return') && (
                      <button onClick={() => setReturning(s)}>Return</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {sales.length === 0 && (
              <tr><td colSpan={isOwner ? 8 : 7} className="empty">No sales in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* View receipt modal */}
      {view && (
        <Modal title={view.receiptNo} onClose={() => setView(null)}>
          <Receipt sale={view} />
          <div className="actions">
            <button className="primary" onClick={() => window.print()}>Print receipt</button>
            {isOwner && view.status === 'completed' && (
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

function ReturnModal({ sale, onClose, onSaved }) {
  const toast = useToast();
  const [qtys, setQtys] = useState(() => Object.fromEntries(sale.items.map((_, i) => [i, ''])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const lines = sale.items
      .map((it, i) => ({ productId: String(it.product), qty: Number(qtys[i]) || 0 }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) return toast('Enter a quantity to return for at least one item', 'err');
    setBusy(true);
    try {
      await api(`/sales/${sale._id}/return`, { method: 'POST', body: { lines, reason } });
      toast('Return recorded and stock restored');
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
                        disabled={remaining <= 0} style={{ width: '5rem' }} />
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
        <div className="actions"><button className="primary" disabled={busy}>Record return</button></div>
      </form>
    </Modal>
  );
}
