import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { Field, RefreshIndicator, TableSkeleton, useToast } from '../ui.jsx';
import { dateTime, fmt, qtyFmt } from '../format.js';

const MOVE_TYPE_CLASS = {
  sale: 'badge-red', void: 'badge-amber', receipt: 'badge-green',
  adjustment: 'badge-amber', opening: 'badge-green', stocktake: 'badge-amber',
};
const TABS = [['receive', 'Receive stock'], ['adjust', 'Adjust stock'], ['stocktake', 'Stock take'], ['history', 'History']];

export default function Stock() {
  const toast = useToast();
  const [tab, setTab] = useState('receive');
  const [products, setProducts] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [moves, setMoves] = useState([]);

  const load = useCallback(() => {
    swrFetch('/products', { onData: setProducts, onRefreshing: setRefreshing, ttlMs: 30_000 })
      .catch((e) => toast(e.message, 'err'));
    api('/stock/movements').then(setMoves).catch(() => {});
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (products === null) return <div className="page"><TableSkeleton cols={5} rows={10} /></div>;

  const low = products.filter((p) => p.stock <= p.reorderLevel && p.stock > 0);
  const out = products.filter((p) => p.stock <= 0);

  return (
    <div className="page">
      <RefreshIndicator refreshing={refreshing} />
      {/* Low / out-of-stock chips */}
      {(out.length > 0 || low.length > 0) && (
        <div className="stock-alerts">
          {out.length > 0 && (
            <div className="stock-alert out">
              <strong>{out.length} out of stock:</strong>{' '}
              {out.slice(0, 5).map((p) => p.name).join(', ')}{out.length > 5 ? `… +${out.length - 5} more` : ''}
            </div>
          )}
          {low.length > 0 && (
            <div className="stock-alert low">
              <strong>{low.length} running low:</strong>{' '}
              {low.slice(0, 5).map((p) => `${p.name} (${qtyFmt(p.stock)})`).join(', ')}{low.length > 5 ? `… +${low.length - 5} more` : ''}
            </div>
          )}
        </div>
      )}

      <div className="tab-bar">
        {TABS.map(([k, l]) => (
          <button key={k} className={`tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'receive' && <MoveForm kind="receive" products={products} onSaved={load} />}
      {tab === 'adjust' && <MoveForm kind="adjust" products={products} onSaved={load} />}
      {tab === 'stocktake' && <StockTakePanel products={products} onSaved={load} />}
      {tab === 'history' && <HistoryTab moves={moves} />}
    </div>
  );
}

function HistoryTab({ moves }) {
  return (
    <div className="tablewrap" style={{ marginTop: '1rem' }}>
      <table>
        <thead>
          <tr><th>When</th><th>Product</th><th>Type</th><th className="num">Qty</th><th>Reason / note</th><th>By</th></tr>
        </thead>
        <tbody>
          {moves.map((m) => (
            <tr key={m._id}>
              <td className="muted-cell">{dateTime(m.createdAt)}</td>
              <td><strong>{m.product?.name}</strong></td>
              <td><span className={`badge ${MOVE_TYPE_CLASS[m.type] || ''}`}>{m.type}</span></td>
              <td className={`num${m.qty < 0 ? ' owes' : ' ok'}`}>
                <strong>{m.qty > 0 ? '+' : ''}{qtyFmt(m.qty)}</strong>
              </td>
              <td className="muted-cell">{m.reason || '–'}</td>
              <td className="muted-cell">{m.user?.name}</td>
            </tr>
          ))}
          {moves.length === 0 && <tr><td colSpan="6" className="empty">No stock movements yet.</td></tr>}
        </tbody>
      </table>
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
      if (kind === 'receive') { if (cost !== '') body.costPrice = Number(cost); body.note = reason; }
      else body.reason = reason;
      await api(`/stock/${kind}`, { method: 'POST', body });
      cacheInvalidatePrefix('/products');
      toast(kind === 'receive' ? 'Stock received' : 'Stock adjusted');
      setLabel(''); setQty(''); setCost(''); setReason(''); onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };

  return (
    <form className="stock-form card grid2" onSubmit={submit} style={{ marginTop: '1rem' }}>
      <Field label="Product" hint={product ? `In stock: ${qtyFmt(product.stock)} · cost ${fmt(product.costPrice)}` : 'Start typing a name or SKU'}>
        <input list="stock-products" value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="Type to search…" />
        <datalist id="stock-products">{products.map((p) => <option key={p._id} value={labelOf(p)} />)}</datalist>
      </Field>
      <Field
        label={kind === 'receive' ? 'Quantity received' : 'Change in quantity'}
        hint={kind === 'adjust' ? 'Use a minus sign to remove, e.g. −3' : undefined}
      >
        <input type="number" step="any" min={kind === 'receive' ? '0' : undefined} value={qty} onChange={(e) => setQty(e.target.value)} required />
      </Field>
      {kind === 'receive' && (
        <Field label="Cost per unit (GH₵)" hint="Leave blank to keep current cost — updates to a running average">
          <input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      )}
      <Field label={kind === 'receive' ? 'Supplier / note (optional)' : 'Reason'}>
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          required={kind === 'adjust'} minLength={kind === 'adjust' ? 3 : undefined}
          placeholder={kind === 'adjust' ? 'e.g. Damaged in storage' : ''} />
      </Field>
      <div className="actions span2">
        <button className="primary">{kind === 'receive' ? 'Receive stock' : 'Adjust stock'}</button>
      </div>
    </form>
  );
}

function StockTakePanel({ products, onSaved }) {
  const toast = useToast();
  const [counts, setCounts] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(null);
  const [viewing, setViewing] = useState(null);

  const setCount = (id, val) => setCounts((c) => ({ ...c, [id]: val }));

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
    const lines = rows.filter((r) => r.counted !== null).map((r) => ({ productId: r.p._id, countedQty: r.counted }));
    if (lines.length === 0) return toast('Enter at least one count', 'err');
    setBusy(true);
    try {
      const st = await api('/stock/stocktake', { method: 'POST', body: { note, lines } });
      cacheInvalidatePrefix('/products');
      setResult(st); setCounts({}); setNote(''); toast('Stock take saved'); onSaved();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  };

  const loadHistory = async () => {
    try { setHistory(await api('/stock/stocktakes')); } catch (e) { toast(e.message, 'err'); }
  };

  const viewTake = async (id) => {
    try { setViewing(await api(`/stock/stocktakes/${id}`)); } catch (e) { toast(e.message, 'err'); }
  };

  if (viewing) return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="head">
        <h2 style={{ margin: 0 }}>Stock take — {dateTime(viewing.createdAt)}</h2>
        <button onClick={() => setViewing(null)}>← Back</button>
      </div>
      <p className="hint">{viewing.createdBy?.name ?? viewing.createdByName}{viewing.note ? ` · ${viewing.note}` : ''}</p>
      <VarianceTable lines={viewing.lines} />
    </div>
  );

  if (history) return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="head">
        <h2 style={{ margin: 0 }}>Stock take history</h2>
        <button onClick={() => setHistory(null)}>← Back</button>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Date</th><th>By</th><th className="num">Counted</th><th className="num">Variances</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {history.map((st) => (
              <tr key={st._id}>
                <td className="muted-cell">{dateTime(st.createdAt)}</td>
                <td>{st.createdBy?.name ?? st.createdByName}</td>
                <td className="num">{st.linesCount}</td>
                <td className="num">{st.varianceCount > 0 ? <span className="owes">{st.varianceCount}</span> : '0'}</td>
                <td className="muted-cell">{st.note || '–'}</td>
                <td className="acts"><button onClick={() => viewTake(st._id)}>View</button></td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan="6" className="empty">No stock takes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (result) return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="head"><h2 style={{ margin: 0 }}>Stock take complete</h2></div>
      <div className="report-kpis" style={{ marginBottom: '1rem' }}>
        <div className="report-kpi"><span>Products counted</span><strong>{result.linesCount}</strong></div>
        <div className={`report-kpi ${result.varianceCount > 0 ? 'warn' : 'ok'}`}>
          <span>Variances</span><strong>{result.varianceCount}</strong>
        </div>
      </div>
      <VarianceTable lines={result.lines.filter((l) => l.variance !== 0)} />
      {result.lines.filter((l) => l.variance === 0).length > 0 && (
        <p className="hint" style={{ marginTop: '.5rem' }}>
          {result.lines.filter((l) => l.variance === 0).length} product(s) matched — no adjustment needed.
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={() => setResult(null)}>New stock take</button>
        <button onClick={loadHistory}>View history</button>
      </div>
    </div>
  );

  return (
    <form className="card" onSubmit={submit} style={{ marginTop: '1rem' }}>
      <div className="page-toolbar" style={{ marginBottom: '.75rem' }}>
        <div className="page-toolbar-left">
          <p className="hint" style={{ margin: 0 }}>Enter physical counts. Leave blank to skip a product.</p>
          {filledCount > 0 && (
            <span className="chip">{filledCount} counted</span>
          )}
          {varianceCount > 0 && (
            <span className="chip chip-red">{varianceCount} variance{varianceCount !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button type="button" onClick={loadHistory}>History</button>
          <button className="primary" disabled={busy || filledCount === 0}>Save &amp; apply</button>
        </div>
      </div>
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. End of month count" />
      </Field>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th className="num">System</th><th className="num">Counted</th><th className="num">Variance</th></tr></thead>
          <tbody>
            {rows.map(({ p, counted, variance }) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td className="muted-cell">{p.sku}</td>
                <td className="num">{qtyFmt(p.stock)}</td>
                <td className="num">
                  <input type="number" min="0" step="any" placeholder="–"
                    value={counts[p._id] ?? ''} onChange={(e) => setCount(p._id, e.target.value)}
                    style={{ width: '5.5rem' }} aria-label={`Count for ${p.name}`} />
                </td>
                <td className={`num${variance !== null && variance < 0 ? ' owes' : variance !== null && variance > 0 ? ' ok' : ''}`}>
                  {variance !== null ? <strong>{variance > 0 ? '+' : ''}{qtyFmt(variance)}</strong> : <span className="muted-cell">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}

function VarianceTable({ lines }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Product</th><th>SKU</th><th className="num">System</th><th className="num">Counted</th><th className="num">Variance</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}</td>
              <td className="muted-cell">{l.sku}</td>
              <td className="num">{qtyFmt(l.systemQty)}</td>
              <td className="num">{qtyFmt(l.countedQty)}</td>
              <td className={`num${l.variance < 0 ? ' owes' : l.variance > 0 ? ' ok' : ''}`}>
                <strong>{l.variance > 0 ? '+' : ''}{qtyFmt(l.variance)}</strong>
              </td>
            </tr>
          ))}
          {lines.length === 0 && <tr><td colSpan="5" className="empty">No variances.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
