import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, cacheSet } from '../cache.js';
import { useAuth } from '../auth.jsx';
import { Field, Modal, useToast } from '../ui.jsx';
import Receipt from '../Receipt.jsx';
import { dateTime, fmt, METHODS, newId, productLabel, qtyFmt, r2 } from '../format.js';
import { cacheProducts, getCachedProducts } from '../offlineDb.js';
import { lineGross, packName, packPriceFor, pieceUnitPrice, unitsOf } from '../bulk.js';
import { useOfflineSync } from '../offlineSync.js';
import { OpenShiftModal, CloseShiftModal } from './ShiftModals.jsx';
import VariantPicker from '../VariantPicker.jsx';
import { groupProducts } from '../variants.js';
import { ChevronLeft, ChevronRight, Minus, PauseCircle, Plus, RotateCcw, Search, ShoppingCart, Trash2, UserRound, X } from 'lucide-react';

// Most of a product that can go in the cart: whole packs when selling by the pack, else pieces.
const maxQty = (p, unit) => (unit === 'pack' && p.unitsPerPack > 1 ? Math.floor(p.stock / p.unitsPerPack) : p.stock);
// "Only 1 box of Key Soap in stock (40 pcs)" / "Only 3 of Royal Rice in stock"
const stockMsg = (p, unit) => (unit === 'pack' && p.unitsPerPack > 1
  ? `Only ${maxQty(p, 'pack')} ${packName(p)}${maxQty(p, 'pack') === 1 ? '' : 's'} of ${productLabel(p)} in stock (${qtyFmt(p.stock)} pcs). Switch to pcs to sell the rest.`
  : `Only ${qtyFmt(p.stock)} of ${productLabel(p)} in stock`);

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
  const nav = useLocation();
  useEffect(() => { if (nav.state?.q) setQ(nav.state.q); }, [nav.state]); // search handed over from the top bar
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
  const [picking, setPicking] = useState(null); // a style whose size/colour is being chosen
  const [category, setCategory] = useState(''); // '' = all
  const [saleCustomer, setSaleCustomer] = useState(''); // chosen before paying (optional)
  const [pickCustomer, setPickCustomer] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
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
    const inCat = category ? products.filter((p) => (p.category || 'General') === category) : products;
    const list = t ? inCat.filter((p) => [productLabel(p), p.sku, p.barcode].some((v) => v && v.toLowerCase().includes(t))) : inCat;
    // Sizes and colours of the same product show as one card (a "style"); see variants.js.
    return groupProducts(list, pieceUnitPrice).slice(0, 80);
  }, [products, search, category]);
  // Category tabs, biggest first.
  const categories = useMemo(() => {
    const m = new Map();
    products.forEach((p) => { const c = p.category || 'General'; m.set(c, (m.get(c) || 0) + 1); });
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [products]);

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
    if (p.stock <= 0) return toast(`${productLabel(p)} is out of stock`, 'err');
    setCart((c) => {
      const hit = c.find((l) => l.id === p._id);
      // Sell by the pack only while at least one full pack is in stock.
      const defaultUnit = p.unitsPerPack > 1 && p.stock >= p.unitsPerPack ? 'pack' : 'piece';
      if (!hit) return [...c, { id: p._id, qty: 1, discount: '', unit: defaultUnit }];
      if (hit.qty + 1 > maxQty(p, hit.unit)) { toast(stockMsg(p, hit.unit), 'err'); return c; }
      return c.map((l) => (l.id === p._id ? { ...l, qty: l.qty + 1 } : l));
    });
  };
  // A style: with one size/colour in stock there is nothing to choose; otherwise ask.
  const openStyle = (style) => {
    const avail = style.variants.filter((v) => v.stock > 0);
    if (style.variants.length === 1 && avail.length === 1) { add(avail[0]); setQ(''); return; }
    setPicking(style);
  };
  const setLine = (id, patch) => setCart((c) => c.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const remove = (id) => setCart((c) => c.filter((l) => l.id !== id));
  // − / + on a line or a product card: one step in the line's unit; reaching 0 takes it out of the cart.
  const step = (id, delta) => setCart((c) => c.flatMap((l) => {
    if (l.id !== id) return [l];
    const p = byId.get(id);
    const next = r2((Number(l.qty) || 0) + delta);
    if (next <= 0) return [];
    if (p && next > maxQty(p, l.unit)) { toast(stockMsg(p, l.unit), 'err'); return [l]; }
    return [{ ...l, qty: next }];
  }));
  const inCart = useMemo(() => new Map(cart.map((l) => [l.id, l])), [cart]);
  const clearCart = () => { setCart([]); setOrderDiscount(''); setSaleCustomer(''); setConfirmClear(false); };

  // Keyboard: F2 = search, F4 = pay.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if (e.key === 'F4') { e.preventDefault(); if (total > 0 && !lines.some((l) => l.qty <= 0)) setPaying(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const t = q.trim().toLowerCase();
    if (!t) return;
    const exact = products.find((p) => p.barcode?.toLowerCase() === t || p.sku.toLowerCase() === t);
    const only = results.length === 1 ? results[0] : null;
    if (exact) { add(exact); setQ(''); return; }
    if (only?.type === 'product') { add(only.product); setQ(''); return; }
    if (only?.type === 'style') { openStyle(only); return; }
    toast('No single match. Pick from the list', 'err');
  };

  const done = (sale) => {
    setPaying(false); setCartOpen(false); setReceipt(sale); setCart([]); setOrderDiscount(''); setQ(''); setSaleCustomer('');
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
          <div className="sell-searchbox">
            <Search size={18} aria-hidden="true" />
            <input
              ref={searchRef}
              className="sell-search"
              placeholder="Scan a barcode or search products"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              aria-label="Search products"
            />
            {q ? <button className="sell-search-clear" onClick={() => { setQ(''); searchRef.current?.focus(); }} aria-label="Clear search"><X size={16} /></button> : <kbd>F2</kbd>}
          </div>
          {categories.length > 1 && (
            <div className="cat-tabs" role="tablist" aria-label="Categories">
              <button role="tab" aria-selected={!category} className={!category ? 'on' : ''} onClick={() => setCategory('')}>All <small>{products.length}</small></button>
              {categories.map(([c, n]) => (
                <button key={c} role="tab" aria-selected={category === c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c} <small>{n}</small></button>
              ))}
            </div>
          )}
        </div>

        <ul className="plist">
          {results.map((item) => {
            if (item.type === 'style') {
              const count = item.variants.reduce((t, v) => t + (inCart.get(v._id) ? 1 : 0), 0);
              return (
                <li key={item.key} className={`pcard${count ? ' in-cart' : ''}${item.stock <= 0 ? ' out' : ''}`}>
                  <button className="pcard-main" disabled={item.stock <= 0} onClick={() => openStyle(item)}>
                    <span className="pcard-media">
                      {item.image?.url ? <img src={item.image.url} alt="" loading="lazy" decoding="async" /> : <span className="pcard-initial">{item.name.charAt(0).toUpperCase()}</span>}
                      {count > 0 && <span className="pcard-badge">{count} in cart</span>}
                      <span className={`pcard-stock${item.stock <= 0 ? ' out' : ''}`}>{item.stock <= 0 ? 'Sold out' : `${qtyFmt(item.stock)} left`}</span>
                    </span>
                    <span className="pcard-cat">{item.category || 'General'}</span>
                    <span className="pcard-name">{item.name}</span>
                    <span className="pcard-sub">
                      {[item.sizes.length ? item.sizes.slice(0, 5).join(' · ') + (item.sizes.length > 5 ? ' …' : '') : null,
                        item.colors.length ? `${item.colors.length} colour${item.colors.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                    </span>
                    <span className="pcard-foot">
                      <span className="pcard-price">{item.minPrice !== item.maxPrice && <small>from </small>}{fmt(item.minPrice)}</span>
                    </span>
                  </button>
                </li>
              );
            }
            const p = item.product;
            const line = inCart.get(p._id);
            const packed = p.unitsPerPack > 1 && p.stock >= p.unitsPerPack;
            return (
              <li key={p._id} className={`pcard${line ? ' in-cart' : ''}${p.stock <= 0 ? ' out' : ''}`}>
                <button className="pcard-main" disabled={p.stock <= 0} onClick={() => add(p)}>
                  <span className="pcard-media">
                    {p.image?.url ? <img src={p.image.url} alt="" loading="lazy" decoding="async" /> : <span className="pcard-initial">{p.name.charAt(0).toUpperCase()}</span>}
                    <span className={`pcard-stock${p.stock <= 0 ? ' out' : p.stock <= p.reorderLevel ? ' low' : ''}`}>{p.stock <= 0 ? 'Out of stock' : `${qtyFmt(p.stock)} left`}</span>
                  </span>
                  <span className="pcard-cat">{p.category || 'General'}</span>
                  <span className="pcard-name">{p.name}{[p.size, p.color].filter(Boolean).map((t) => <span key={t} className="size-chip">{t}</span>)}</span>
                  <span className="pcard-sub">{p.sku}{p.unitsPerPack > 1 ? ` · ${p.unitsPerPack} per ${packName(p)}` : ''}</span>
                  <span className="pcard-foot">
                    <span className="pcard-price">{packed ? <>{fmt(packPriceFor(p))}<small> / {packName(p)}</small></> : fmt(priceOf(p))}</span>
                  </span>
                </button>
                {line && (
                  <div className="pcard-qty" aria-label={`${productLabel(p)} in cart`}>
                    <button onClick={() => step(p._id, -1)} aria-label="One less"><Minus size={16} /></button>
                    <span>{qtyFmt(line.qty)}{line.unit === 'pack' ? ` ${packName(p)}` : ''}</span>
                    <button onClick={() => step(p._id, 1)} aria-label="One more"><Plus size={16} /></button>
                  </div>
                )}
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="plist-empty">{q ? `No products match "${q}".` : 'No products in this category.'}</li>
          )}
        </ul>
      </section>

      {/* ── Current sale ── */}
      <aside className="cart">
        <div className="cart-header">
          <button className="cart-close" onClick={() => setCartOpen(false)} aria-label="Back to products"><ChevronLeft size={18} /> Products</button>
          <span className="cart-title">Current sale{lines.length > 0 && <span className="cart-count">{lines.length}</span>}</span>
          <button className="cart-clear" disabled={lines.length === 0} onClick={() => setConfirmClear(true)} aria-label="Clear the sale"><Trash2 size={16} /></button>
        </div>

        {/* Same actions as the banner, kept next to Pay so they are never missed on a phone */}
        <div className="cart-shift">
          {shift === null && <><span>No shift is open</span><button className="primary" onClick={() => setShowOpenShift(true)}>Open shift</button></>}
          {shift && <><span>Shift open · {shift.openedBy?.name ?? shift.openedByName}</span><button onClick={() => setShowCloseShift(true)}>Close shift</button></>}
        </div>

        <button className="cart-customer" onClick={() => setPickCustomer(true)}>
          <span className="cart-customer-icon"><UserRound size={18} /></span>
          {(() => { const c = customers.find((c) => c._id === saleCustomer); return c ? (
            <span className="cart-customer-text"><strong>{c.name}</strong><small>{[c.phone, c.balance > 0 ? `owes ${fmt(c.balance)}` : null].filter(Boolean).join(' · ') || 'Customer'}</small></span>
          ) : (
            <span className="cart-customer-text"><strong>Walk-in customer</strong><small>Tap to add a customer (optional)</small></span>
          ); })()}
          <ChevronRight size={16} className="cart-customer-go" />
        </button>

        <div className="lines">
          {lines.length === 0 && (
            <div className="cart-empty">
              <span className="cart-empty-icon"><ShoppingCart size={34} /></span>
              <p>No items yet</p>
              <small>Scan a barcode or tap a product</small>
            </div>
          )}
          {lines.map((l) => (
            <div className="line" key={l.id}>
              <div className="line-top">
                <span className="line-name">{productLabel(l.p)}</span>
                <strong className="line-total">{fmt(l.total)}</strong>
              </div>
              <div className="line-bottom">
                {l.hasPack && (
                  <div className="seg line-unit" role="group" aria-label="Unit">
                    <button className={l.unit === 'pack' ? 'on' : ''} onClick={() => setLine(l.id, { unit: 'pack', qty: 1 })}>{l.p.packLabel || 'pack'}</button>
                    <button className={l.unit === 'piece' ? 'on' : ''} onClick={() => setLine(l.id, { unit: 'piece', qty: 1 })}>pcs</button>
                  </div>
                )}
                <div className="stepper">
                  <button onClick={() => step(l.id, -1)} aria-label="One less"><Minus size={14} /></button>
                  <input
                    type="number" min="0" step="any" value={l.qty} aria-label="Quantity" inputMode="decimal"
                    onChange={(e) => setLine(l.id, { qty: Math.min(Number(e.target.value) || 0, maxQty(l.p, l.unit)) })}
                  />
                  <button onClick={() => step(l.id, 1)} aria-label="One more"><Plus size={14} /></button>
                </div>
                <span className="line-meta">× {l.hasPack && l.unit === 'pack' ? `${fmt(l.packPrice)} / ${packName(l.p)}` : fmt(l.price)}{l.hasPack && l.unit === 'pack' ? ` · ${qtyFmt(l.pieceQty)} pcs` : ''}</span>
                <button className="line-remove" onClick={() => remove(l.id)} aria-label={`Remove ${productLabel(l.p)}`}><X size={15} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="totals">
          <div className="totals-row"><span>Items</span><span>{lines.length}</span></div>
          <div className="totals-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
          <div className="totals-row">
            <span>Discount (GH₵)</span>
            <input
              type="number" min="0" step="0.01" value={orderDiscount} placeholder="0.00" inputMode="decimal"
              onChange={(e) => setOrderDiscount(e.target.value)} aria-label="Order discount"
            />
          </div>
          <div className="totals-grand">
            <span>Total</span>
            <strong>{fmt(total)}</strong>
          </div>
          <div className="cart-buttons">
            <button disabled={lines.length === 0} onClick={() => setShowHold(true)}><PauseCircle size={16} /> Hold</button>
            <button onClick={() => setShowResume(true)} className="resume-btn"><RotateCcw size={16} /> Resume{heldCount > 0 && <span className="held-badge">{heldCount}</span>}</button>
          </div>
          <button
            className="pay-btn"
            disabled={total <= 0 || lines.some((l) => l.qty <= 0)}
            onClick={() => setPaying(true)}
          >
            <span>Pay {total > 0 ? fmt(total) : ''}</span><kbd>F4</kbd>
          </button>
        </div>
      </aside>

      {/* Mobile: sticky bar that opens the cart */}
      <button className="cart-bar" onClick={() => setCartOpen(true)} disabled={cartOpen}>
        <span className="cart-bar-left"><ShoppingCart size={18} /> {lines.length ? `${lines.length} item${lines.length === 1 ? '' : 's'}` : 'No items'}</span>
        <strong>{lines.length ? `View sale · ${fmt(total)}` : fmt(0)}</strong>
      </button>

      {/* ── Modals ── */}
      {paying && (
        <PayModal
          total={total} customers={customers} initialCustomer={saleCustomer}
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
      {pickCustomer && (
        <Modal title="Customer for this sale" onClose={() => setPickCustomer(false)}>
          <CustomerPicker customers={customers} value={saleCustomer} onAdded={(c) => setCustomers((x) => [...x, c])}
            onChange={(id) => { setSaleCustomer(id); if (id) setPickCustomer(false); }} />
          <div className="actions"><button onClick={() => setPickCustomer(false)}>Done</button></div>
        </Modal>
      )}
      {confirmClear && (
        <Modal title="Clear this sale?" onClose={() => setConfirmClear(false)}>
          <p>All {lines.length} item{lines.length === 1 ? '' : 's'} will be removed from the cart. Nothing is saved.</p>
          <div className="actions">
            <button onClick={() => setConfirmClear(false)}>Keep</button>
            <button className="danger" onClick={clearCart}>Clear sale</button>
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
      {picking && (
        <VariantPicker style={picking} priceOf={pieceUnitPrice} onClose={() => setPicking(null)}
          onPick={(v) => { add(v); setPicking(null); setQ(''); toast(`Added ${productLabel(v)}`); }} />
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

function PayModal({ total, customers, initialCustomer = '', build, onDone, onClose, onCustomerAdded }) {
  const toast = useToast();
  const [rows, setRows] = useState([{ method: 'Cash', amount: String(total) }]);
  const [customerId, setCustomerId] = useState(initialCustomer);
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
