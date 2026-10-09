import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, useToast } from '../ui.jsx';
import Receipt from '../Receipt.jsx';
import { dateTime, fmt, qtyFmt, todayStr } from '../format.js';

export default function Sales() {
  const { isOwner } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [sales, setSales] = useState([]);
  const [view, setView] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [returning, setReturning] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    api(`/sales?from=${from}&to=${to}`).then(setSales).catch((e) => toast(e.message, 'err'));
  }, [from, to, toast]);
  useEffect(load, [load]);

  const doVoid = async () => {
    try {
      await api(`/sales/${voiding._id}/void`, { method: 'POST', body: { reason } });
      toast(`${voiding.receiptNo} voided and stock restored`);
      setVoiding(null); setReason(''); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <h1>Sales</h1>
      <div className="filters">
        <Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Receipt</th><th>Time</th><th>Cashier</th><th>Customer</th><th className="num">Total</th><th className="num">On credit</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s._id} className={s.status === 'voided' ? 'voided' : ''}>
              <td>{s.receiptNo}</td><td>{dateTime(s.createdAt)}</td><td>{s.cashier?.name}</td><td>{s.customerName || 'Walk-in'}</td>
              <td className="num">{fmt(s.total)}</td><td className="num">{s.balance > 0 ? fmt(s.balance) : '–'}</td><td>{s.status}</td>
              <td className="acts"><button onClick={() => setView(s)}>View</button>
                {isOwner && s.status === 'completed' && <button className="danger" onClick={() => setVoiding(s)}>Void</button>}
                {isOwner && (s.status === 'completed' || s.status === 'partial-return') && <button onClick={() => setReturning(s)}>Return</button>}</td>
            </tr>
          ))}
          {sales.length === 0 && <tr><td colSpan="8" className="empty">No sales in this period.</td></tr>}
        </tbody>
      </table></div>

      {view && <Modal title={view.receiptNo} onClose={() => setView(null)}><Receipt sale={view} />
        <div className="actions"><button className="primary" onClick={() => window.print()}>Print receipt</button></div></Modal>}
      {voiding && (
        <Modal title={`Void ${voiding.receiptNo}`} onClose={() => setVoiding(null)}>
          <p>This returns the items to stock and cancels the sale ({fmt(voiding.total)}). It can't be undone.</p>
          <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer returned everything" /></Field>
          <div className="actions"><button className="danger" disabled={reason.trim().length < 3} onClick={doVoid}>Void sale</button></div>
        </Modal>
      )}
      {returning && <ReturnModal sale={returning} onClose={() => setReturning(null)} onSaved={() => { setReturning(null); load(); }} />}
    </div>
  );
}

function ReturnModal({ sale, onClose, onSaved }) {
  const toast = useToast();
  const [qtys, setQtys] = useState(() =>
    Object.fromEntries(sale.items.map((it, i) => [i, '']))
  );
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
        <div className="tablewrap"><table>
          <thead><tr><th>Product</th><th className="num">Sold</th><th className="num">Already returned</th><th className="num">Return qty</th></tr></thead>
          <tbody>
            {sale.items.map((it, i) => {
              const remaining = it.qty - (it.returnedQty || 0);
              return (
                <tr key={i}>
                  <td>{it.name}</td>
                  <td className="num">{qtyFmt(it.qty)}</td>
                  <td className="num">{qtyFmt(it.returnedQty || 0)}</td>
                  <td className="num">
                    <input type="number" min="0" max={remaining} step="any"
                      value={qtys[i]} onChange={(e) => setQtys({ ...qtys, [i]: e.target.value })}
                      disabled={remaining <= 0} style={{ width: '5rem' }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged goods" required minLength={3} /></Field>
        <div className="actions"><button className="primary" disabled={busy}>Record return</button></div>
      </form>
    </Modal>
  );
}
