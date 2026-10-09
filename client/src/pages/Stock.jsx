import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { dateTime, fmt, qtyFmt } from '../format.js';

export default function Stock() {
  const toast = useToast();
  const [tab, setTab] = useState('receive');
  const [products, setProducts] = useState([]);
  const [moves, setMoves] = useState([]);

  const load = useCallback(() => {
    api('/products').then(setProducts).catch((e) => toast(e.message, 'err'));
    api('/stock/movements').then(setMoves).catch(() => {});
  }, [toast]);
  useEffect(load, [load]);

  const low = products.filter((p) => p.stock <= p.reorderLevel);

  return (
    <div className="page">
      <h1>Stock</h1>
      {low.length > 0 && (
        <div className="notice"><strong>{low.length} item{low.length > 1 ? 's' : ''} low or out of stock:</strong>{' '}
          {low.slice(0, 8).map((p) => `${p.name} (${qtyFmt(p.stock)})`).join(', ')}{low.length > 8 ? '…' : ''}</div>
      )}
      <div className="seg" role="tablist">
        {[['receive', 'Receive stock'], ['adjust', 'Adjust stock'], ['stocktake', 'Stock take'], ['history', 'History']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'receive' && <MoveForm kind="receive" products={products} onSaved={load} />}
      {tab === 'adjust' && <MoveForm kind="adjust" products={products} onSaved={load} />}
      {tab === 'stocktake' && <StockTakeForm products={products} />}
      {tab === 'history' && (
        <div className="tablewrap"><table>
          <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="num">Qty</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m._id}><td>{dateTime(m.createdAt)}</td><td>{m.product?.name}</td><td>{m.type}</td>
                <td className={`num${m.qty < 0 ? ' owes' : ''}`}>{m.qty > 0 ? '+' : ''}{qtyFmt(m.qty)}</td><td>{m.reason || ''}</td><td>{m.user?.name}</td></tr>
            ))}
            {moves.length === 0 && <tr><td colSpan="6" className="empty">No stock movements yet.</td></tr>}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function MoveForm({ kind, products, onSaved }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const labelOf = (p) => `${p.name} — ${p.sku}`;
  const product = useMemo(() => products.find((p) => labelOf(p) === label), [products, label]);

  const submit = async (e) => {
    e.preventDefault();
    if (!product) return toast('Choose a product from the list', 'err');
    try {
      const body = { productId: product._id, qty: Number(qty) };
      if (kind === 'receive') { if (cost !== '') body.costPrice = Number(cost); body.note = reason; } else body.reason = reason;
      await api(`/stock/${kind}`, { method: 'POST', body });
      toast(kind === 'receive' ? 'Stock received' : 'Stock adjusted');
      setLabel(''); setQty(''); setCost(''); setReason(''); onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <form className="card grid2" onSubmit={submit}>
      <Field label="Product" hint={product ? `In stock now: ${qtyFmt(product.stock)} · current cost ${fmt(product.costPrice)}` : 'Start typing a name or SKU'}>
        <input list="stock-products" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <datalist id="stock-products">{products.map((p) => <option key={p._id} value={labelOf(p)} />)}</datalist>
      </Field>
      <Field label={kind === 'receive' ? 'Quantity received' : 'Change in quantity'} hint={kind === 'adjust' ? 'Use a minus sign to remove, e.g. -3' : undefined}>
        <input type="number" step="any" min={kind === 'receive' ? '0' : undefined} value={qty} onChange={(e) => setQty(e.target.value)} required />
      </Field>
      {kind === 'receive' && (
        <Field label="Cost per unit (GH₵)" hint="Leave blank to keep the current cost. Cost updates to a running average">
          <input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      )}
      <Field label={kind === 'receive' ? 'Supplier or note (optional)' : 'Reason'}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} required={kind === 'adjust'} minLength={kind === 'adjust' ? 3 : undefined}
          placeholder={kind === 'adjust' ? 'e.g. Damaged in storage' : ''} />
      </Field>
      <div className="actions span2"><button className="primary">{kind === 'receive' ? 'Receive stock' : 'Adjust stock'}</button></div>
    </form>
  );
}

function StockTakeForm({ products }) {
  const toast = useToast();
  // counts: { [productId]: string }  — only products the user has typed a count for
  const [counts, setCounts] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // completed StockTake doc
  const [history, setHistory] = useState(null); // list view
  const [viewing, setViewing] = useState(null); // single past stock take

  const setCount = (id, val) => setCounts((c) => ({ ...c, [id]: val }));

  // Preview variance for products that have a count entered.
  const rows = products.map((p) => {
    const raw = counts[p._id];
    const counted = raw !== undefined && raw !== '' ? Number(raw) : null;
    const variance = counted !== null ? Math.round((counted - p.stock) * 1000) / 1000 : null;
    return { p, counted, variance };
  });

  const filledCount = rows.filter((r) => r.counted !== null).length;
  const varianceCount = rows.filter((r) => r.variance !== null && r.variance !== 0).length;

  const submit = async (e) => {
    e.preventDefault();
    const lines = rows
      .filter((r) => r.counted !== null)
      .map((r) => ({ productId: r.p._id, countedQty: r.counted }));
    if (lines.length === 0) return toast('Enter at least one count', 'err');
    setBusy(true);
    try {
      const st = await api('/stock/stocktake', { method: 'POST', body: { note, lines } });
      setResult(st);
      setCounts({});
      setNote('');
      toast('Stock take saved');
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  };

  const loadHistory = async () => {
    try { setHistory(await api('/stock/stocktakes')); } catch (e) { toast(e.message, 'err'); }
  };

  const viewTake = async (id) => {
    try { setViewing(await api(`/stock/stocktakes/${id}`)); } catch (e) { toast(e.message, 'err'); }
  };

  if (viewing) {
    return (
      <div className="card">
        <div className="head">
          <h2>Stock take — {dateTime(viewing.createdAt)}</h2>
          <button onClick={() => setViewing(null)}>← Back</button>
        </div>
        <p className="hint">By {viewing.createdBy?.name ?? viewing.createdByName}{viewing.note ? ` · ${viewing.note}` : ''}</p>
        <div className="tablewrap"><table>
          <thead><tr><th>Product</th><th>SKU</th><th className="num">System</th><th className="num">Counted</th><th className="num">Variance</th></tr></thead>
          <tbody>
            {viewing.lines.map((l, i) => (
              <tr key={i} className={l.variance !== 0 ? 'warn' : ''}>
                <td>{l.name}</td><td>{l.sku}</td>
                <td className="num">{qtyFmt(l.systemQty)}</td>
                <td className="num">{qtyFmt(l.countedQty)}</td>
                <td className={`num${l.variance < 0 ? ' owes' : l.variance > 0 ? ' ok' : ''}`}>
                  {l.variance > 0 ? '+' : ''}{qtyFmt(l.variance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    );
  }

  if (history) {
    return (
      <div className="card">
        <div className="head"><h2>Stock take history</h2><button onClick={() => setHistory(null)}>← Back</button></div>
        <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>By</th><th className="num">Products counted</th><th className="num">Variances</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {history.map((st) => (
              <tr key={st._id}>
                <td>{dateTime(st.createdAt)}</td>
                <td>{st.createdBy?.name ?? st.createdByName}</td>
                <td className="num">{st.linesCount}</td>
                <td className={`num${st.varianceCount > 0 ? ' owes' : ''}`}>{st.varianceCount}</td>
                <td>{st.note || '—'}</td>
                <td><button onClick={() => viewTake(st._id)}>View</button></td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan="6" className="empty">No stock takes yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="card">
        <div className="head"><h2>Stock take complete</h2></div>
        <div className="stats">
          <div><span>Products counted</span><strong>{result.linesCount}</strong></div>
          <div className={result.varianceCount > 0 ? 'key owes' : 'key'}>
            <span>Variances</span><strong>{result.varianceCount}</strong>
          </div>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Product</th><th>SKU</th><th className="num">System</th><th className="num">Counted</th><th className="num">Variance</th></tr></thead>
          <tbody>
            {result.lines.filter((l) => l.variance !== 0).map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td><td>{l.sku}</td>
                <td className="num">{qtyFmt(l.systemQty)}</td>
                <td className="num">{qtyFmt(l.countedQty)}</td>
                <td className={`num${l.variance < 0 ? ' owes' : ' ok'}`}>
                  {l.variance > 0 ? '+' : ''}{qtyFmt(l.variance)}
                </td>
              </tr>
            ))}
            {result.lines.filter((l) => l.variance === 0).length > 0 && (
              <tr><td colSpan="5" className="hint">
                {result.lines.filter((l) => l.variance === 0).length} product(s) matched — no adjustment needed.
              </td></tr>
            )}
          </tbody>
        </table></div>
        <div className="actions">
          <button className="primary" onClick={() => setResult(null)}>New stock take</button>
          <button onClick={loadHistory}>View history</button>
        </div>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="head">
        <div>
          <p className="hint">Enter the physical count for each product. Leave blank to skip a product.</p>
          {filledCount > 0 && <p className="hint"><strong>{filledCount}</strong> counted · <strong className={varianceCount > 0 ? 'owes' : ''}>{varianceCount}</strong> variance(s)</p>}
        </div>
        <div className="acts">
          <button type="button" onClick={loadHistory}>History</button>
          <button className="primary" disabled={busy || filledCount === 0}>Save count</button>
        </div>
      </div>
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. End of month count" />
      </Field>
      <div className="tablewrap"><table>
        <thead><tr><th>Product</th><th>SKU</th><th className="num">System qty</th><th className="num">Counted qty</th><th className="num">Variance</th></tr></thead>
        <tbody>
          {rows.map(({ p, counted, variance }) => (
            <tr key={p._id} className={variance !== null && variance !== 0 ? 'warn' : ''}>
              <td>{p.name}</td>
              <td>{p.sku}</td>
              <td className="num">{qtyFmt(p.stock)}</td>
              <td className="num">
                <input
                  type="number" min="0" step="any" placeholder="—"
                  value={counts[p._id] ?? ''}
                  onChange={(e) => setCount(p._id, e.target.value)}
                  style={{ width: '6rem' }}
                  aria-label={`Count for ${p.name}`}
                />
              </td>
              <td className={`num${variance !== null && variance < 0 ? ' owes' : variance > 0 ? ' ok' : ''}`}>
                {variance !== null ? (variance > 0 ? '+' : '') + qtyFmt(variance) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="actions">
        <button className="primary" disabled={busy || filledCount === 0}>Save count &amp; apply adjustments</button>
      </div>
    </form>
  );
}
