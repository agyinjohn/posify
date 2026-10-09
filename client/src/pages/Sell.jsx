import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, useToast } from '../ui.jsx';
import Receipt from '../Receipt.jsx';
import { dateTime, fmt, METHODS, qtyFmt, r2 } from '../format.js';
import { cacheProducts, getCachedProducts } from '../offlineDb.js';
import { useOfflineSync } from '../offlineSync.js';

export default function Sell() {
  const toast = useToast();
  const { isOwner } = useAuth();
  const { online, queue } = useOfflineSync();
  const [cacheAge, setCacheAge] = useState(null); // ISO string of last cache write
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('retail');
  const [cart, setCart] = useState([]); // { id, qty, discount }
  const [orderDiscount, setOrderDiscount] = useState('');
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [holdLabel, setHoldLabel] = useState('');
  const [showHold, setShowHold] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [shift, setShift] = useState(undefined); // undefined = loading, null = none open
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const searchRef = useRef(null);

  const loadShift = useCallback(() => {
    api('/shifts/current').then(setShift).catch(() => setShift(null));
  }, []);

  const load = useCallback(async () => {
    if (!navigator.onLine) {
      // Offline: serve products from IndexedDB cache.
      const cached = await getCachedProducts();
      if (cached) { setProducts(cached.data); setCacheAge(cached.cachedAt); }
      return;
    }
    try {
      const ps = await api('/products');
      setProducts(ps);
      setCacheAge(null);
      cacheProducts(ps).catch(() => {}); // fire-and-forget
    } catch (e) { toast(e.message, 'err'); }
    api('/customers').then(setCustomers).catch(() => {});
  }, [toast]);
  useEffect(() => { load(); loadShift(); searchRef.current?.focus(); }, [load, loadShift]);

  const byId = useMemo(() => new Map(products.map((p) => [p._id, p])), [products]);
  const priceOf = useCallback((p) => (mode === 'wholesale' && p.wholesalePrice > 0 ? p.wholesalePrice : p.retailPrice), [mode]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? products.filter((p) => [p.name, p.sku, p.barcode].some((v) => v && v.toLowerCase().includes(t))) : products;
    return list.slice(0, 60);
  }, [products, q]);

  const lines = cart.filter((c) => byId.has(c.id)).map((c) => {
    const p = byId.get(c.id);
    const hasPack = p.unitsPerPack > 1;
    const unit = c.unit || 'piece';
    const pieceQty = (unit === 'pack' && hasPack) ? r2(c.qty * p.unitsPerPack) : c.qty;
    const gross = r2(priceOf(p) * pieceQty);
    const discount = Math.min(Math.max(Number(c.discount) || 0, 0), gross);
    return { ...c, p, unit, hasPack, pieceQty, price: priceOf(p), gross, discount, total: r2(gross - discount) };
  });
  const subtotal = r2(lines.reduce((s, l) => s + l.total, 0));
  const od = Math.min(Math.max(Number(orderDiscount) || 0, 0), subtotal);
  const total = r2(subtotal - od);

  const add = (p) => {
    if (p.stock <= 0) return toast(`${p.name} is out of stock`, 'err');
    setCart((c) => {
      const hit = c.find((l) => l.id === p._id);
      // Default to pack unit if the product has one
      const defaultUnit = p.unitsPerPack > 1 ? 'pack' : 'piece';
      if (!hit) return [...c, { id: p._id, qty: 1, discount: '', unit: defaultUnit }];
      if (hit.qty + 1 > p.stock) { toast(`Only ${qtyFmt(p.stock)} of ${p.name} in stock`, 'err'); return c; }
      return c.map((l) => (l.id === p._id ? { ...l, qty: l.qty + 1 } : l));
    });
  };
  const setLine = (id, patch) => setCart((c) => c.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id) => setCart((c) => c.filter((l) => l.id !== id));

  // Barcode scanners type the code and press Enter.
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const t = q.trim().toLowerCase();
    if (!t) return;
    const exact = products.find((p) => p.barcode?.toLowerCase() === t || p.sku.toLowerCase() === t);
    const pick = exact || (results.length === 1 ? results[0] : null);
    if (pick) { add(pick); setQ(''); } else toast('No single match. Pick from the list', 'err');
  };

  const done = (sale) => {
    setPaying(false); setReceipt(sale); setCart([]); setOrderDiscount(''); setQ(''); load();
  };

  const holdSale = async () => {
    if (lines.length === 0) return;
    try {
      await api('/held-sales', {
        method: 'POST',
        body: {
          label: holdLabel.trim(),
          mode,
          orderDiscount: od,
          items: lines.map((l) => ({ productId: l.id, qty: l.qty, discount: l.discount || 0 })),
        },
      });
      toast('Sale held');
      setCart([]); setOrderDiscount(''); setQ(''); setHoldLabel(''); setShowHold(false);
    } catch (e) { toast(e.message, 'err'); }
  };

  const resumeSale = (held) => {
    setMode(held.mode);
    setOrderDiscount(String(held.orderDiscount || ''));
    setCart(held.items.map((i) => ({ id: String(i.productId), qty: i.qty, discount: i.discount || '' })));
    setShowResume(false);
  };

  return (
    <div className="sell">
      {/* Shift banner */}
      {shift === null && (
        <div className="notice warn">
          No shift is open.{' '}
          <button className="primary" onClick={() => setShowOpenShift(true)}>Open shift</button>
        </div>
      )}
      {shift && (
        <div className="notice">
          Shift open since {dateTime(shift.createdAt)} by {shift.openedBy?.name ?? shift.openedByName}.{' '}
          <button onClick={() => setShowCloseShift(true)}>Close shift</button>
        </div>
      )}
      {/* Offline banner */}
      {!online && (
        <div className="notice warn">
          <strong>Offline</strong> — sales will be queued and synced when you reconnect.
          {cacheAge && <> Products loaded from cache ({dateTime(cacheAge)}).</>}
        </div>
      )}
      {online && queue.length > 0 && (
        <div className="notice">
          {queue.filter((q) => q.status === 'pending').length} sale(s) syncing…
          {queue.filter((q) => q.status === 'error').length > 0 && (
            <> · <strong className="owes">{queue.filter((q) => q.status === 'error').length} failed</strong> — check the queue panel.</>
          )}
        </div>
      )}
      <section className="catalog">
        <div className="bar">
          <input ref={searchRef} className="search" placeholder="Scan barcode or search name / SKU" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Search products" />
          <div className="seg" role="group" aria-label="Sale type">
            {['retail', 'wholesale'].map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'retail' ? 'Retail' : 'Wholesale'}</button>
            ))}
          </div>
        </div>
        <ul className="plist">
          {results.map((p) => (
            <li key={p._id}>
              <button disabled={p.stock <= 0} onClick={() => add(p)}>
                <span className="pname">{p.name}<small>{p.sku}{p.unitsPerPack > 1 ? ` · ${p.unitsPerPack} pcs/${p.packLabel || 'pack'}` : ''}</small></span>
                <span className={`stock${p.stock <= p.reorderLevel ? ' low' : ''}`}>{p.stock <= 0 ? 'Out of stock' : `${qtyFmt(p.stock)} left`}</span>
                <span className="price">{fmt(priceOf(p))}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="empty">No products match “{q}”.</li>}
        </ul>
      </section>

      <aside className="cart">
        <div className="lines">
          {lines.length === 0 && <p className="empty">Cart is empty. Scan or tap a product to start the sale.</p>}
          {lines.map((l) => (
            <div className="line" key={l.id}>
              <div className="top"><strong>{l.p.name}</strong><button className="ghost" onClick={() => remove(l.id)} aria-label={`Remove ${l.p.name}`}>Remove</button></div>
              <div className="ctrl">
                {l.hasPack && (
                  <div className="seg" role="group" aria-label="Unit">
                    <button className={l.unit === 'pack' ? 'on' : ''} onClick={() => setLine(l.id, { unit: 'pack', qty: 1 })}>{l.p.packLabel || 'pack'}</button>
                    <button className={l.unit === 'piece' ? 'on' : ''} onClick={() => setLine(l.id, { unit: 'piece', qty: 1 })}>pcs</button>
                  </div>
                )}
                <input type="number" min="0" step="any" value={l.qty} aria-label="Quantity"
                  onChange={(e) => setLine(l.id, { qty: Math.min(Number(e.target.value) || 0, l.unit === 'pack' ? Math.floor(l.p.stock / l.p.unitsPerPack) : l.p.stock) })} />
                {l.hasPack && l.unit === 'pack' && <small>= {qtyFmt(l.pieceQty)} pcs</small>}
                <span>× {fmt(l.price)}</span>
                <input type="number" min="0" step="0.01" placeholder="Discount" value={l.discount} aria-label="Line discount"
                  onChange={(e) => setLine(l.id, { discount: e.target.value })} />
                <b>{fmt(l.total)}</b>
              </div>
            </div>
          ))}
        </div>
        <div className="totals">
          <div className="row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
          <div className="row"><span>Order discount</span>
            <input type="number" min="0" step="0.01" value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} aria-label="Order discount" /></div>
          <div className="grand"><span>Total</span><strong>{fmt(total)}</strong></div>
          <div className="hold-row">
            <button disabled={lines.length === 0} onClick={() => setShowHold(true)}>Hold sale</button>
            <button onClick={() => setShowResume(true)}>Resume held</button>
          </div>
          <button className="primary big" disabled={total <= 0 || lines.some((l) => l.qty <= 0)} onClick={() => setPaying(true)}>Take payment</button>
        </div>
      </aside>

      {paying && (
        <PayModal total={total} customers={customers} onClose={() => setPaying(false)} onCustomerAdded={(c) => setCustomers((s) => [...s, c])}
          build={(payments, customerId) => ({
            items: lines.map((l) => ({ productId: l.id, qty: l.qty, unit: l.unit, discount: l.discount || 0 })),
            mode, orderDiscount: od, payments, customerId: customerId || undefined,
          })}
          onDone={done} />
      )}
      {receipt && (
        <Modal title={receipt._offlineQueued ? 'Sale queued (offline)' : 'Sale complete'} onClose={() => setReceipt(null)}>
          {receipt._offlineQueued
            ? (
              <>
                <div className="notice warn">
                  <strong>You are offline.</strong> This sale has been saved locally as <strong>{receipt.receiptNo}</strong> and will be sent to the server automatically when you reconnect.
                </div>
                <p className="hint">Do not close the app until the sale has synced.</p>
              </>
            )
            : <Receipt sale={receipt} />}
          <div className="actions">
            {!receipt._offlineQueued && <button className="primary" onClick={() => window.print()}>Print receipt</button>}
            <button onClick={() => setReceipt(null)}>New sale</button>
          </div>
        </Modal>
      )}
      {showHold && (
        <Modal title="Hold this sale" onClose={() => setShowHold(false)}>
          <p>The cart will be saved and you can resume it later.</p>
          <label className="field"><span>Label (optional)</span>
            <input placeholder="e.g. Customer name" value={holdLabel} onChange={(e) => setHoldLabel(e.target.value)} />
          </label>
          <div className="actions">
            <button className="primary" onClick={holdSale}>Hold sale</button>
          </div>
        </Modal>
      )}
      {showResume && (
        <ResumeDrawer onClose={() => setShowResume(false)} onResume={resumeSale} />
      )}
      {showOpenShift && (
        <OpenShiftModal onClose={() => setShowOpenShift(false)} onOpened={(s) => { setShift(s); setShowOpenShift(false); }} />
      )}
      {showCloseShift && shift && (
        <CloseShiftModal shift={shift} onClose={() => setShowCloseShift(false)}
          onClosed={() => { setShift(null); setShowCloseShift(false); }} />
      )}
    </div>
  );
}

function ResumeDrawer({ onClose, onResume }) {
  const toast = useToast();
  const [list, setList] = useState([]);

  useEffect(() => {
    api('/held-sales').then(setList).catch((e) => toast(e.message, 'err'));
  }, [toast]);

  const resume = async (held) => {
    try {
      await api(`/held-sales/${held._id}`, { method: 'DELETE' });
      onResume(held);
      toast('Sale resumed');
    } catch (e) { toast(e.message, 'err'); }
  };

  const discard = async (id) => {
    try {
      await api(`/held-sales/${id}`, { method: 'DELETE' });
      setList((l) => l.filter((h) => h._id !== id));
      toast('Held sale discarded');
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <Modal title="Resume a held sale" onClose={onClose}>
      {list.length === 0 && <p className="hint">No held sales.</p>}
      {list.map((h) => (
        <div className="held-row" key={h._id}>
          <div>
            <strong>{h.label || 'Unnamed sale'}</strong>
            <small>{dateTime(h.createdAt)} · {h.items.length} item{h.items.length !== 1 ? 's' : ''} · {h.mode}{h.cashier?.name ? ` · ${h.cashier.name}` : ''}</small>
          </div>
          <div className="acts">
            <button className="primary" onClick={() => resume(h)}>Resume</button>
            <button className="danger" onClick={() => discard(h._id)}>Discard</button>
          </div>
        </div>
      ))}
    </Modal>
  );
}

function PayModal({ total, customers, build, onDone, onClose, onCustomerAdded }) {
  const toast = useToast();
  const [rows, setRows] = useState([]); // { method, amount }
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const paid = r2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = r2(Math.max(total - paid, 0));
  const change = r2(Math.max(paid - total, 0));
  const cash = r2(rows.filter((r) => r.method === 'Cash').reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const overNonCash = change > cash;
  const needsCustomer = remaining > 0 && !customerId;

  const addRow = (method) => setRows((r) => [...r, { method, amount: remaining > 0 ? String(remaining) : '' }]);
  const setRow = (i, amount) => setRows((r) => r.map((x, j) => (j === i ? { ...x, amount } : x)));

  const addCustomer = async () => {
    if (!newName.trim()) return;
    try { const c = await api('/customers', { method: 'POST', body: { name: newName.trim() } }); onCustomerAdded(c); setCustomerId(c._id); setNewName(''); }
    catch (e) { toast(e.message, 'err'); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const payments = rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount) }));
      onDone(await api('/sales', { method: 'POST', body: build(payments, customerId) }));
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };

  return (
    <Modal title="Take payment" onClose={onClose}>
      <div className="due"><span>Amount due</span><strong>{fmt(total)}</strong></div>
      <p className="hint">How did the customer pay? Tap a method for each amount received.</p>
      <div className="methods">{METHODS.map((m) => <button key={m} onClick={() => addRow(m)}>{m}</button>)}</div>
      {rows.map((r, i) => (
        <div className="payrow" key={i}>
          <span>{r.method}</span>
          <input type="number" min="0" step="0.01" value={r.amount} onChange={(e) => setRow(i, e.target.value)} aria-label={`${r.method} amount`} />
          <button className="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="summary">
        <div className="row"><span>Received</span><span>{fmt(paid)}</span></div>
        {change > 0 && <div className="row ok"><span>Change to give</span><strong>{fmt(change)}</strong></div>}
        {remaining > 0 && <div className="row warn"><span>Left to pay (credit)</span><strong>{fmt(remaining)}</strong></div>}
      </div>
      {overNonCash && <div className="error">Only cash can be over the total. Lower the MoMo / card / transfer amount.</div>}
      {remaining > 0 && (
        <div className="credit">
          <label className="field"><span>Customer who owes {fmt(remaining)}</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose a customer</option>
              {customers.map((c) => <option key={c._id} value={c._id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
            </select></label>
          <div className="inline"><input placeholder="Or add new customer name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button onClick={addCustomer}>Add customer</button></div>
        </div>
      )}
      <div className="actions">
        <button className="primary big" disabled={busy || overNonCash || needsCustomer} onClick={submit}>
          {busy ? 'Saving…' : remaining > 0 ? 'Complete as credit sale' : 'Complete sale'}
        </button>
      </div>
    </Modal>
  );
}

function OpenShiftModal({ onClose, onOpened }) {
  const toast = useToast();
  const [float, setFloat] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const shift = await api('/shifts/open', { method: 'POST', body: { openingFloat: Number(float) || 0, note } });
      toast('Shift opened'); onOpened(shift);
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title="Open shift" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Opening float (cash in drawer, GH₵)">
          <input type="number" min="0" step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Morning shift" />
        </Field>
        <div className="actions"><button className="primary" disabled={busy}>Open shift</button></div>
      </form>
    </Modal>
  );
}

function CloseShiftModal({ shift, onClose, onClosed }) {
  const toast = useToast();
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const res = await api(`/shifts/${shift._id}/close`, { method: 'POST', body: { closingCash: Number(cash) || 0, note } });
      setSummary(res.summary);
      toast('Shift closed');
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  if (summary) {
    return (
      <Modal title="Shift closed — summary" onClose={onClosed}>
        <div className="stats">
          <div><span>Sales</span><strong>{summary.salesCount}</strong></div>
          <div className="key"><span>Total sold</span><strong>{fmt(summary.total)}</strong></div>
          <div><span>Discounts</span><strong>{fmt(summary.discounts)}</strong></div>
          <div><span>Sold on credit</span><strong>{fmt(summary.creditGiven)}</strong></div>
          <div><span>Debts collected</span><strong>{fmt(summary.debtCollected)}</strong></div>
        </div>
        <h3>By payment method</h3>
        <div className="tablewrap narrow"><table><tbody>
          {Object.entries(summary.byMethod).map(([m, v]) => (
            <tr key={m}><td>{m}</td><td className="num">{fmt(v)}</td></tr>
          ))}
        </tbody></table></div>
        <div className="stats">
          <div><span>Expected cash</span><strong>{fmt(summary.expectedCash)}</strong></div>
          <div className={summary.cashVariance < 0 ? 'key owes' : 'key'}>
            <span>Cash variance</span><strong>{fmt(summary.cashVariance)}</strong>
          </div>
        </div>
        <div className="actions"><button className="primary" onClick={onClosed}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title="Close shift" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Cash in drawer now (GH₵)" hint="Count the physical cash and enter the total">
          <input type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} required />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. End of day" />
        </Field>
        <div className="actions"><button className="primary" disabled={busy}>Close shift &amp; see summary</button></div>
      </form>
    </Modal>
  );
}
