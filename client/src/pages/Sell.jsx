import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, cacheSet } from '../cache.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, useToast } from '../ui.jsx';
import Receipt from '../Receipt.jsx';
import { dateTime, fmt, METHODS, newId, qtyFmt, r2 } from '../format.js';
import { cacheProducts, getCachedProducts } from '../offlineDb.js';
import { lineGross, packName, packPriceFor, pieceUnitPrice, unitsOf } from '../bulk.js';
import { useOfflineSync } from '../offlineSync.js';
import { OpenShiftModal, CloseShiftModal } from './ShiftModals.jsx';

// Most of a product that can go in the cart: whole packs when selling by the pack, else pieces.
const maxQty = (p, unit) => (unit === 'pack' && p.unitsPerPack > 1 ? Math.floor(p.stock / p.unitsPerPack) : p.stock);

export default function Sell() {
  const toast = useToast();
  const { isOwner } = useAuth();
  const { online, queue } = useOfflineSync();
  const [cacheAge, setCacheAge] = useState(null);
  const [cartOpen, setCartOpen] = useState(false); // mobile only: cart slides up over the catalog
  // Start from the background-prefetched copies so the till is usable on the very first paint.
  const [products, setProducts] = useState(() => cacheGet('/products') ?? []);
  const [customers, setCustomers] = useState(() => cacheGet('/customers?q=') ?? []);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [orderDiscount, setOrderDiscount] = useState('');
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [holdLabel, setHoldLabel] = useState('');
  const [showHold, setShowHold] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [shift, setShift] = useState(undefined);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const searchRef = useRef(null);

  const loadShift = useCallback(() => {
    api('/shifts/current').then(setShift).catch(() => setShift(null));
  }, []);

  const load = useCallback(async () => {
    if (!navigator.onLine) {
      const cached = await getCachedProducts();
      if (cached) { setProducts(cached.data); setCacheAge(cached.cachedAt); }
      return;
    }
    // Customers load alongside the products instead of after them.
    api('/customers?q=').then((cs) => { cacheSet('/customers?q=', cs, 5 * 60_000); setCustomers(cs); }).catch(() => {});
    try {
      const ps = await api('/products');
      cacheSet('/products', ps, 5 * 60_000);
      setProducts(ps);
      setCacheAge(null);
      cacheProducts(ps).catch(() => {});
    } catch (e) { toast(e.message, 'err'); }
  }, [toast]);

  const loadHeldCount = useCallback(() => {
    api('/held-sales').then((l) => setHeldCount(l.length)).catch(() => {});
  }, []);

  useEffect(() => { load(); loadShift(); loadHeldCount(); searchRef.current?.focus(); }, [load, loadShift, loadHeldCount]);

  const byId = useMemo(() => new Map(products.map((p) => [p._id, p])), [products]);
  // Single pieces pay the piece (retail) price, a full pack the pack (wholesale) price: see bulk.js.
  const priceOf = useCallback((p) => pieceUnitPrice(p), []);

  const search = useDeferredValue(q); // typing stays instant while a big catalogue is filtered
  const results = useMemo(() => {
    const t = search.trim().toLowerCase();
    const list = t ? products.filter((p) => [p.name, p.sku, p.barcode].some((v) => v && v.toLowerCase().includes(t))) : products;
    return list.slice(0, 60);
  }, [products, search]);

  const lines = cart.filter((c) => byId.has(c.id)).map((c) => {
    const p = byId.get(c.id);
    const hasPack = p.unitsPerPack > 1;
    const unit = c.unit || 'piece';
    const pieceQty = (unit === 'pack' && hasPack) ? r2(c.qty * p.unitsPerPack) : c.qty;
    const gross = lineGross(p, unit, c.qty); // pieces at the piece price, packs at the pack price
    const discount = Math.min(Math.max(Number(c.discount) || 0, 0), gross);
    return { ...c, p, unit, hasPack, pieceQty, price: priceOf(p), packPrice: hasPack ? packPriceFor(p) : null, gross, discount, total: r2(gross - discount) };
  });
  const subtotal = r2(lines.reduce((s, l) => s + l.total, 0));
  const od = Math.min(Math.max(Number(orderDiscount) || 0, 0), subtotal);
  const total = r2(subtotal - od);

  const add = (p) => {
    if (p.stock <= 0) return toast(`${p.name} is out of stock`, 'err');
    setCart((c) => {
      const hit = c.find((l) => l.id === p._id);
      // Sell by the pack only while at least one full pack is in stock.
      const defaultUnit = p.unitsPerPack > 1 && p.stock >= p.unitsPerPack ? 'pack' : 'piece';
      if (!hit) return [...c, { id: p._id, qty: 1, discount: '', unit: defaultUnit }];
      if (hit.qty + 1 > maxQty(p, hit.unit)) { toast(`Only ${qtyFmt(p.stock)} of ${p.name} in stock`, 'err'); return c; }
      return c.map((l) => (l.id === p._id ? { ...l, qty: l.qty + 1 } : l));
    });
  };
  const setLine = (id, patch) => setCart((c) => c.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id) => setCart((c) => c.filter((l) => l.id !== id));

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const t = q.trim().toLowerCase();
    if (!t) return;
    const exact = products.find((p) => p.barcode?.toLowerCase() === t || p.sku.toLowerCase() === t);
    const pick = exact || (results.length === 1 ? results[0] : null);
    if (pick) { add(pick); setQ(''); } else toast('No single match. Pick from the list', 'err');
  };

  const done = (sale) => {
    setPaying(false); setCartOpen(false); setReceipt(sale); setCart([]); setOrderDiscount(''); setQ('');
    // The sale changed stock, balances and today's figures: drop stale copies so other screens refetch.
    ['/products', '/customers', '/sales', '/reports'].forEach(cacheInvalidatePrefix);
    load();
  };

  const holdSale = async () => {
    if (lines.length === 0) return;
    try {
      await api('/held-sales', {
        method: 'POST',
        body: {
          label: holdLabel.trim(),
          orderDiscount: od,
          items: lines.map((l) => ({ productId: l.id, qty: l.qty, unit: l.unit, discount: l.discount || 0 })),
        },
      });
      toast('Sale held');
      setCart([]); setOrderDiscount(''); setQ(''); setHoldLabel(''); setShowHold(false);
      loadHeldCount();
    } catch (e) { toast(e.message, 'err'); }
  };

  const resumeSale = (held) => {
    setOrderDiscount(String(held.orderDiscount || ''));
    setCart(held.items.map((i) => ({ id: String(i.productId), qty: i.qty, unit: i.unit || 'piece', discount: i.discount || '' })));
    // Products deactivated or deleted since the sale was held can't be sold: say so instead of dropping them silently.
    const gone = held.items.filter((i) => !byId.has(String(i.productId))).length;
    if (gone > 0) toast(`${gone} item${gone !== 1 ? 's were' : ' was'} no longer available and left out`, 'err');
    setShowResume(false);
    loadHeldCount();
  };

  const pendingCount = queue.filter((i) => i.status === 'pending').length;
  const failedCount = queue.filter((i) => i.status === 'error').length;

  return (
    <div className={`sell${cartOpen ? ' cart-open' : ''}`}>

      {/* ── Banners ── */}
      <div className="sell-banners">
        {shift === null && (
          <div className="sell-banner warn">
            No shift is open.{' '}
            <button onClick={() => setShowOpenShift(true)}>Open shift</button>
          </div>
        )}
        {shift && (
          <div className="sell-banner info">
            Shift open since {dateTime(shift.createdAt)} · {shift.openedBy?.name ?? shift.openedByName}{' '}
            <button onClick={() => setShowCloseShift(true)}>Close shift</button>
          </div>
        )}
        {!online && (
          <div className="sell-banner warn">
            <strong>Offline</strong> — sales are queued locally.
            {cacheAge && <> Products from cache ({dateTime(cacheAge)}).</>}
          </div>
        )}
        {online && queue.length > 0 && (
          <div className={`sell-banner ${failedCount > 0 ? 'warn' : 'info'}`}>
            {pendingCount > 0 && <>{pendingCount} sale(s) syncing…</>}
            {failedCount > 0 && <> · <strong>{failedCount} failed</strong> — check the queue panel.</>}
          </div>
        )}
      </div>

      {/* ── Catalog ── */}
      <section className="catalog">
        <div className="catalog-top">
          <input
            ref={searchRef}
            className="sell-search"
            placeholder="🔍  Scan barcode or search name / SKU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            aria-label="Search products"
          />
        </div>

        <ul className="plist">
          {results.map((p) => (
            <li key={p._id}>
              <button disabled={p.stock <= 0} onClick={() => add(p)}>
                {p.image?.url && <img className="pcard-img" src={p.image.url} alt="" loading="lazy" decoding="async" />}
                <span className="pname">
                  {p.name}
                  <small>{p.sku}{p.unitsPerPack > 1 ? ` · ${p.unitsPerPack}/${p.packLabel || 'pack'}` : ''}</small>
                </span>
                <span className="pcard-footer">
                  <span className={`stock${p.stock <= p.reorderLevel ? ' low' : ''}`}>
                    {p.stock <= 0 ? 'Out of stock' : `${qtyFmt(p.stock)} left`}
                  </span>
                  <span className="price">
                    {p.unitsPerPack > 1 && p.stock >= p.unitsPerPack
                      ? <>{fmt(packPriceFor(p))}<small> / {packName(p)}</small></>
                      : fmt(priceOf(p))}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="plist-empty">No products match "{q}".</li>
          )}
        </ul>
      </section>

      {/* ── Cart ── */}
      <aside className="cart">
        <div className="cart-header">
          <span className="cart-title">
            Cart{lines.length > 0 && <span className="cart-count">{lines.length}</span>}
          </span>
          <div className="cart-actions">
            <button className="cart-close" onClick={() => setCartOpen(false)} aria-label="Back to products">← Products</button>
            <button disabled={lines.length === 0} onClick={() => setShowHold(true)}>Hold</button>
            <button onClick={() => setShowResume(true)} style={{ position: 'relative' }}>
              Resume{heldCount > 0 && <span className="held-badge">{heldCount}</span>}
            </button>
          </div>
        </div>

        {/* Same actions as the banner, kept next to Charge so they are never missed on a phone */}
        <div className="cart-shift">
          {shift === null && <><span>No shift is open</span><button className="primary" onClick={() => setShowOpenShift(true)}>Open shift</button></>}
          {shift && <><span>Shift open · {shift.openedBy?.name ?? shift.openedByName}</span><button onClick={() => setShowCloseShift(true)}>Close shift</button></>}
        </div>

        <div className="lines">
          {lines.length === 0 && (
            <div className="cart-empty">
              <span className="cart-empty-icon">🛒</span>
              <p>Cart is empty</p>
              <small>Scan or tap a product to start</small>
            </div>
          )}
          {lines.map((l) => (
            <div className="line" key={l.id}>
              <div className="line-top">
                <span className="line-name">{l.p.name}</span>
                <button className="line-remove" onClick={() => remove(l.id)} aria-label={`Remove ${l.p.name}`}>×</button>
              </div>
              <div className={`line-ctrl${l.hasPack ? ' has-pack' : ''}`}>
                {l.hasPack && (
                  <div className="seg" role="group" aria-label="Unit">
                    <button className={l.unit === 'pack' ? 'on' : ''} onClick={() => setLine(l.id, { unit: 'pack', qty: 1 })}>{l.p.packLabel || 'pack'}</button>
                    <button className={l.unit === 'piece' ? 'on' : ''} onClick={() => setLine(l.id, { unit: 'piece', qty: 1 })}>pcs</button>
                  </div>
                )}
                <input
                  type="number" min="0" step="any" value={l.qty} aria-label="Quantity"
                  onChange={(e) => setLine(l.id, { qty: Math.min(Number(e.target.value) || 0, maxQty(l.p, l.unit)) })}
                />
                <span className="line-meta">{l.hasPack && l.unit === 'pack' ? `${fmt(l.packPrice)} / ${packName(l.p)}` : fmt(l.price)} × {l.qty}</span>
                <strong className="line-total">{fmt(l.total)}</strong>
              </div>
              {l.hasPack && l.unit === 'pack' && (
                <div className="line-pack-hint">= {qtyFmt(l.pieceQty)} pcs</div>
              )}
            </div>
          ))}
        </div>

        <div className="totals">
          <div className="totals-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
          <div className="totals-row">
            <span>Discount</span>
            <input
              type="number" min="0" step="0.01" value={orderDiscount}
              onChange={(e) => setOrderDiscount(e.target.value)} aria-label="Order discount"
            />
          </div>
          <div className="totals-grand">
            <span>Total</span>
            <strong>{fmt(total)}</strong>
          </div>
          <button
            className="pay-btn"
            disabled={total <= 0 || lines.some((l) => l.qty <= 0)}
            onClick={() => setPaying(true)}
          >
            Charge {total > 0 ? fmt(total) : ''}
          </button>
        </div>
      </aside>

      {/* Mobile: sticky bar that opens the cart */}
      <button className="cart-bar" onClick={() => setCartOpen(true)} disabled={cartOpen}>
        <span>🛒 Cart{lines.length > 0 ? ` (${lines.length})` : ''}</span>
        <strong>{fmt(total)}</strong>
      </button>

      {/* ── Modals ── */}
      {paying && (
        <PayModal
          total={total} customers={customers}
          onClose={() => setPaying(false)}
          onCustomerAdded={(c) => setCustomers((s) => [...s, c])}
          build={(payments, customerId) => ({
            items: lines.map((l) => ({ productId: l.id, qty: l.qty, unit: l.unit, discount: l.discount || 0 })),
            orderDiscount: od, payments, customerId: customerId || undefined,
          })}
          onDone={done}
        />
      )}
      {receipt && (
        <Modal title={receipt._offlineQueued ? 'Sale queued (offline)' : 'Sale complete'} onClose={() => setReceipt(null)}>
          {receipt._offlineQueued ? (
            <>
              <div className="notice warn">
                <strong>You are offline.</strong> This sale has been saved locally as <strong>{receipt.receiptNo}</strong> and will sync automatically when you reconnect.
              </div>
              <p className="hint">Do not close the app until the sale has synced.</p>
            </>
          ) : <Receipt sale={receipt} />}
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
          <div className="actions"><button className="primary" onClick={holdSale}>Hold sale</button></div>
        </Modal>
      )}
      {showResume && <ResumeDrawer cartHasItems={cart.length > 0} onClose={() => setShowResume(false)} onResume={resumeSale} />}
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

function ResumeDrawer({ onClose, onResume, cartHasItems }) {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [confirming, setConfirming] = useState(null); // held sale id awaiting 'replace the cart?' answer

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
            <small>{dateTime(h.createdAt)} · {h.items.length} item{h.items.length !== 1 ? 's' : ''} {h.cashier?.name ? ` · ${h.cashier.name}` : ''}</small>
          </div>
          <div className="acts">
            {confirming === h._id ? (
              <>
                <small>Replace the current cart?</small>
                <button className="primary" onClick={() => resume(h)}>Replace</button>
                <button onClick={() => setConfirming(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="primary" onClick={() => (cartHasItems ? setConfirming(h._id) : resume(h))}>Resume</button>
                <button className="danger" onClick={() => discard(h._id)}>Discard</button>
              </>
            )}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function PayModal({ total, customers, build, onDone, onClose, onCustomerAdded }) {
  const toast = useToast();
  const [rows, setRows] = useState([{ method: 'Cash', amount: String(total) }]);
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState(false);
  // One key per payment attempt: if the reply is lost and the cashier taps again, the server
  // returns the first sale instead of creating a second.
  const clientId = useRef(newId());

  const paid = r2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = r2(Math.max(total - paid, 0));
  const change = r2(Math.max(paid - total, 0));
  const cash = r2(rows.filter((r) => r.method === 'Cash').reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const overNonCash = change > cash;
  const needsCustomer = remaining > 0 && !customerId;

  const addRow = (method) => setRows((r) => [...r, { method, amount: remaining > 0 ? String(remaining) : '' }]);
  const setRow = (i, amount) => setRows((r) => r.map((x, j) => (j === i ? { ...x, amount } : x)));

  const submit = async () => {
    setBusy(true);
    try {
      const payments = rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount) }));
      onDone(await api('/sales', { method: 'POST', body: { ...build(payments, customerId), clientId: clientId.current } }));
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
      <CustomerPicker
        customers={customers} value={customerId} onChange={setCustomerId} onAdded={onCustomerAdded}
        required={remaining > 0} owed={remaining}
      />
      <div className="actions sticky-actions">
        <button className="primary big" disabled={busy || overNonCash || needsCustomer} onClick={submit}>
          {busy ? 'Saving…' : remaining > 0 ? 'Complete as credit sale' : 'Complete sale'}
        </button>
      </div>
    </Modal>
  );
}

// Optional on any sale (the name and phone then print on the receipt); required when part of the sale is on credit.
function CustomerPicker({ customers, value, onChange, onAdded, required, owed }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = customers.find((c) => c._id === value);
  const t = q.trim().toLowerCase();
  const matches = (t ? customers.filter((c) => c.name.toLowerCase().includes(t) || (c.phone || '').includes(t)) : customers).slice(0, 5);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await api('/customers', { method: 'POST', body: { name: name.trim(), phone: phone.trim() || undefined } });
      onAdded(c); onChange(c._id);
      setAdding(false); setName(''); setPhone(''); setQ('');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <div className={`customer-pick${required ? ' required' : ''}`}>
      <div className="customer-pick-head">
        <strong>Customer</strong>
        <span className="hint">{required ? `Required: ${fmt(owed)} is on credit` : 'Optional. Shown on the receipt'}</span>
      </div>

      {chosen ? (
        <div className="customer-chosen">
          <div>
            <strong>{chosen.name}</strong>
            {chosen.phone && <small>{chosen.phone}</small>}
            {chosen.balance > 0 && <small className="owes">Owes {fmt(chosen.balance)}</small>}
          </div>
          <button type="button" onClick={() => onChange('')}>Change</button>
        </div>
      ) : adding ? (
        <div className="customer-new">
          <input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <input placeholder="Phone (optional)" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div className="customer-new-actions">
            <button type="button" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="primary" disabled={busy || !name.trim()} onClick={add}>Save customer</button>
          </div>
        </div>
      ) : (
        <>
          <input placeholder="Search customer by name or phone" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" aria-label="Search customers" />
          <ul className="customer-results">
            {matches.map((c) => (
              <li key={c._id}>
                <button type="button" onClick={() => { onChange(c._id); setQ(''); }}>
                  <span>{c.name}</span>
                  <small>{c.phone || ''}{c.balance > 0 ? `${c.phone ? ' · ' : ''}owes ${fmt(c.balance)}` : ''}</small>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="customer-none">No customer found{customers.length === 0 ? ' (add one below)' : ''}.</li>}
          </ul>
          <button type="button" className="customer-add" onClick={() => { setAdding(true); setName(q.trim()); }}>+ Add new customer</button>
        </>
      )}
    </div>
  );
}
