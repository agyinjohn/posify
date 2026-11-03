import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { CardSkeleton, Field, Modal, RefreshIndicator, useToast } from '../ui.jsx';
import { fmt, qtyFmt } from '../format.js';
import { packName, toPackPrice, toPiecePrice, toPieces, toPacks, unitsOf } from '../bulk.js';

const PRICE_KEYS = ['costPrice', 'retailPrice', 'wholesalePrice'];
const blank = { name: '', sku: '', barcode: '', category: 'General', costPrice: '', retailPrice: '', wholesalePrice: '', reorderLevel: 0, stock: 0, unitsPerPack: 1, packLabel: '' };

export default function Products() {
  const toast = useToast();
  const [list, setList] = useState(() => cacheGet('/products?all=1&q='));
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = useCallback(() => {
    const key = `/products?all=1&q=${encodeURIComponent(q)}${low ? '&lowStock=1' : ''}`;
    swrFetch(key, { onData: setList, onRefreshing: setRefreshing, ttlMs: 60_000 })
      .catch((e) => toast(e.message, 'err'));
  }, [q, low, toast]);
  useEffect(() => { load(); }, [load]);

  if (list === null) return <div className="page"><CardSkeleton count={12} /></div>;
  const lowCount = list.filter((p) => p.active && p.stock <= p.reorderLevel).length;

  return (
    <div className="page">
      <RefreshIndicator refreshing={refreshing} />
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <input className="search" placeholder="Search name, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
          {lowCount > 0 && <span className="chip chip-red">{lowCount} low</span>}
          {list.length > 0 && <span className="chip">{list.length} product{list.length !== 1 ? 's' : ''}</span>}
        </div>
        <button className="primary" onClick={() => setEdit(blank)}>Add product</button>
      </div>

      <div className="product-grid">
        {list.map((p) => (
          <div key={p._id} className={`product-card${p.active ? '' : ' inactive'}`} onClick={() => setEdit(p)}>
            {p.image?.url
              ? <img className="product-card-img" src={p.image.url} alt="" loading="lazy" decoding="async" />
              : <div className="product-card-img placeholder" />}
            <div className="product-card-body">
              <div className="product-card-name">{p.name}{!p.active && <span className="chip chip-muted">inactive</span>}</div>
              <div className="product-card-sku">{p.sku}{p.category !== 'General' ? ` · ${p.category}` : ''}</div>
              <div className="product-card-prices">
                {unitsOf(p) > 1 ? (
                  <>
                    <span className="product-card-price">{fmt(toPackPrice(p.retailPrice, unitsOf(p)))}<small> / {packName(p)}</small></span>
                    <span className="product-card-ws">{fmt(p.retailPrice)} each{p.wholesalePrice > 0 ? ` · WS ${fmt(toPackPrice(p.wholesalePrice, unitsOf(p)))}` : ''}</span>
                  </>
                ) : (
                  <>
                    <span className="product-card-price">{fmt(p.retailPrice)}</span>
                    {p.wholesalePrice > 0 && <span className="product-card-ws">WS {fmt(p.wholesalePrice)}</span>}
                  </>
                )}
              </div>
              <div className="product-card-footer">
                <span className={`stock-badge${p.stock <= 0 ? ' out' : p.stock <= p.reorderLevel ? ' low' : ''}`}>
                  {p.stock <= 0 ? 'Out of stock' : `${qtyFmt(p.stock)} in stock`}
                </span>
                <span className="product-card-cost">Cost {fmt(unitsOf(p) > 1 ? toPackPrice(p.costPrice, unitsOf(p)) : p.costPrice)}{unitsOf(p) > 1 ? ` / ${packName(p)}` : ''}</span>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div className="product-grid-empty">
            {q || low ? 'No products match your filters.' : 'No products yet. Add your first product.'}
          </div>
        )}
      </div>

      {edit && <ProductForm p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ProductForm({ p, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !p._id;
  // Prices are stored per piece, but the owner thinks in cartons: when the product has a pack size,
  // cost / retail / wholesale (and opening stock) are typed per pack and converted on save.
  const [f, setF] = useState(() => {
    const base = { ...blank, ...p, barcode: p.barcode || '' };
    const u = unitsOf(base);
    if (u > 1) for (const k of PRICE_KEYS) if (base[k] !== '' && base[k] != null) base[k] = String(toPackPrice(base[k], u));
    return base;
  });
  const init = useRef({ prices: PRICE_KEYS.map((k) => f[k]), units: unitsOf(f) }); // to leave untouched prices exactly as stored
  const [mode, setMode] = useState('pack'); // 'pack' | 'piece': what the price fields mean when a pack size is set
  const [busy, setBusy] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const units = unitsOf({ unitsPerPack: f.unitsPerPack });
  const packMode = units > 1 && mode === 'pack';
  const pack = packName({ packLabel: f.packLabel });

  const onUnitsChange = (e) => {
    const next = unitsOf({ unitsPerPack: e.target.value });
    const g = { ...f, unitsPerPack: e.target.value };
    // Existing product that had no pack size: keep each piece's price the same by showing it per pack.
    if (!isNew && units === 1 && next > 1 && mode === 'pack') {
      for (const k of PRICE_KEYS) if (g[k] !== '' && g[k] != null) g[k] = String(toPackPrice(g[k], next));
    }
    setF(g);
  };

  const switchMode = (m) => {
    if (m === mode) return;
    const g = { ...f };
    for (const k of PRICE_KEYS) {
      if (g[k] === '' || g[k] == null) continue;
      g[k] = String(m === 'piece' ? toPiecePrice(g[k], units) : toPackPrice(g[k], units));
    }
    if (isNew && g.stock !== '' && g.stock != null) g.stock = String(m === 'piece' ? toPieces(g.stock, units) : toPacks(g.stock, units));
    setF(g); setMode(m);
  };

  const toPiece = (v) => (packMode ? toPiecePrice(v, units) : Number(v));
  const other = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : (packMode ? toPiecePrice(v, units) : toPackPrice(v, units)));
  const otherHint = (v) => {
    const o = other(v);
    if (o === null || units <= 1) return undefined;
    return packMode ? `= ${fmt(o)} per piece` : `= ${fmt(o)} per ${pack}`;
  };
  const margin = Number(f.costPrice) > 0 && Number(f.retailPrice) > 0
    ? Math.round(((Number(f.retailPrice) - Number(f.costPrice)) / Number(f.costPrice)) * 1000) / 10 : null;
  const unitWord = packMode ? pack : 'piece';

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = {
      name: f.name, sku: f.sku, barcode: f.barcode, category: f.category,
      costPrice: toPiece(f.costPrice) || 0, retailPrice: toPiece(f.retailPrice),
      wholesalePrice: toPiece(f.wholesalePrice) || 0, reorderLevel: Number(f.reorderLevel) || 0,
      unitsPerPack: units, packLabel: f.packLabel.trim(),
    };
    // Editing: converting a per-pack figure back can round a price that was never touched (10.333 -> 10.333333),
    // so only send the prices the owner actually changed.
    if (!isNew && units === init.current.units) {
      PRICE_KEYS.forEach((k, i) => { if (f[k] === init.current.prices[i]) delete body[k]; });
    }
    if (isNew) body.stock = packMode ? toPieces(f.stock || 0, units) : Number(f.stock) || 0;
    try {
      const saved = await api(isNew ? '/products' : `/products/${p._id}`, { method: isNew ? 'POST' : 'PATCH', body });
      cacheInvalidatePrefix('/products');
      if (isNew && pendingImage) {
        const form = new FormData(); form.append('image', pendingImage);
        await api(`/products/${saved._id}/image`, { method: 'POST', form }).catch(() => {});
      }
      toast('Product saved'); onSaved();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  const upload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const form = new FormData(); form.append('image', file);
    try { const r = await api(`/products/${p._id}/image`, { method: 'POST', form }); setF({ ...f, image: r.image }); toast('Image uploaded'); }
    catch (err) { toast(err.message, 'err'); }
  };

  const toggleActive = async () => {
    try { await api(`/products/${p._id}`, { method: 'PATCH', body: { active: !p.active } }); toast(p.active ? 'Product hidden' : 'Product active'); onSaved(); }
    catch (err) { toast(err.message, 'err'); }
  };

  return (
    <Modal title={isNew ? 'Add product' : `Edit ${p.name}`} onClose={onClose} wide>
      <form onSubmit={save} className="grid2">
        <Field label="Name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="SKU" hint="Short unique code to identify this product, e.g. RICE-5KG"><input value={f.sku} onChange={set('sku')} required /></Field>
        <Field label="Barcode" hint="Scan it here, or leave blank"><input value={f.barcode} onChange={set('barcode')} /></Field>
        <Field label="Category"><input value={f.category} onChange={set('category')} /></Field>

        {/* Pack size first, so the price fields below know what they are measuring */}
        <Field label="Pieces per pack" hint="e.g. 12 for a carton of 12. Leave 1 if it is only sold by the piece"><input type="number" min="1" step="1" value={f.unitsPerPack} onChange={onUnitsChange} /></Field>
        <Field label="Pack name" hint='e.g. "ctn", "box", "bag"'><input value={f.packLabel} onChange={set('packLabel')} placeholder="ctn" maxLength={20} /></Field>

        {units > 1 && (
          <div className="span2 bulk-mode">
            <span>Enter prices and stock per</span>
            <div className="seg" role="group" aria-label="Price entry unit">
              <button type="button" className={packMode ? 'on' : ''} onClick={() => switchMode('pack')}>{pack} (of {units})</button>
              <button type="button" className={!packMode ? 'on' : ''} onClick={() => switchMode('piece')}>piece</button>
            </div>
            <small>{packMode ? `Type what a whole ${pack} costs and sells for. Each piece is worked out for you.` : 'Type the price of a single piece.'}</small>
          </div>
        )}

        <Field label={`Cost price per ${unitWord} (GH₵)`} hint={otherHint(f.costPrice)}>
          <input type="number" min="0" step="any" inputMode="decimal" value={f.costPrice} onChange={set('costPrice')} required />
        </Field>
        <Field label={`Retail price per ${unitWord} (GH₵)`} hint={[otherHint(f.retailPrice), margin !== null ? `margin ${margin}%` : null].filter(Boolean).join(' · ') || undefined}>
          <input type="number" min="0" step="any" inputMode="decimal" value={f.retailPrice} onChange={set('retailPrice')} required />
        </Field>
        <Field label={`Wholesale price per ${unitWord} (GH₵)`} hint={Number(f.wholesalePrice) > 0 ? otherHint(f.wholesalePrice) : 'Leave 0 to use the retail price'}>
          <input type="number" min="0" step="any" inputMode="decimal" value={f.wholesalePrice} onChange={set('wholesalePrice')} />
        </Field>
        <Field label={units > 1 ? 'Reorder level (pieces)' : 'Reorder level'} hint="Show a low-stock warning when stock drops to or below this number"><input type="number" min="0" step="any" value={f.reorderLevel} onChange={set('reorderLevel')} /></Field>
        {isNew && (
          <Field label={`Opening stock (${unitWord}${packMode ? 's' : ''})`} hint={packMode && Number(f.stock) > 0 ? `= ${toPieces(f.stock, units)} pieces` : undefined}>
            <input type="number" min="0" step="any" inputMode="decimal" value={f.stock} onChange={set('stock')} />
          </Field>
        )}
        {isNew && (
          <Field label="Product image (optional)" hint="JPG, PNG or WebP, up to 2 MB">
            {pendingImage && <img className="preview" src={URL.createObjectURL(pendingImage)} alt="" />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPendingImage(e.target.files[0] || null)} />
          </Field>
        )}
        {!isNew && (
          <Field label="Product image" hint="JPG, PNG or WebP, up to 2 MB">
            {f.image?.url && <img className="preview" src={f.image.url} alt="" />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} />
          </Field>
        )}
        <div className="actions span2">
          {!isNew && <button type="button" className={p.active ? 'danger' : ''} onClick={toggleActive}>{p.active ? 'Hide from sales' : 'Make active'}</button>}
          <button className="primary" disabled={busy}>Save product</button>
        </div>
      </form>
      {!isNew && <p className="hint">Stock changes go through the Stock page so every change has a record.</p>}
    </Modal>
  );
}
