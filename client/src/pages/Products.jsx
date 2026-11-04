import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { CardSkeleton, Field, Modal, RefreshIndicator, useToast } from '../ui.jsx';
import { fmt, qtyFmt } from '../format.js';
import { packName, packPriceFor, toPackPrice, toPiecePrice, toPieces, unitsOf } from '../bulk.js';

const blank = { name: '', sku: '', barcode: '', category: 'General', costPrice: '', retailPrice: '', wholesalePrice: '', packRetailPrice: '', packWholesalePrice: '', reorderLevel: 0, stock: 0, unitsPerPack: 1, packLabel: '' };

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
              <div className="product-card-sku">{p.sku}{p.category && p.category !== 'General' ? ` · ${p.category}` : ''}</div>
              <div className="product-card-prices">
                {unitsOf(p) > 1 ? (
                  <>
                    <span className="product-card-price">{fmt(packPriceFor(p, 'retail'))}<small> per {packName(p)}</small></span>
                    <span className="product-card-ws">{fmt(p.retailPrice)} each{p.wholesalePrice > 0 || p.packWholesalePrice > 0 ? ` · WS ${fmt(packPriceFor(p, 'wholesale'))}` : ''}</span>
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

// Cost and selling prices for a product that comes in cartons/boxes: the owner can type the price per piece, per
// carton, or both. Leave one empty and it is worked out from the other (carton / pieces per carton, or piece x
// pieces per carton). A carton price typed here is kept as its own price, so cartons can sell for less than the
// pieces added up; a piece price with no carton price just sells cartons at pieces x piece price.
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const money = (n) => (n === null || n === undefined ? undefined : fmt(n));

function ProductForm({ p, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !p._id;
  const [f, setF] = useState(() => ({
    ...blank, ...p, barcode: p.barcode || '',
    costPrice: p.costPrice ?? '', retailPrice: p.retailPrice ?? '',
    wholesalePrice: p.wholesalePrice > 0 ? p.wholesalePrice : '',
    costPack: '',
    packRetailPrice: p.packRetailPrice > 0 ? p.packRetailPrice : '',
    packWholesalePrice: p.packWholesalePrice > 0 ? p.packWholesalePrice : '',
  }));
  const [stockUnit, setStockUnit] = useState('pack'); // opening stock typed in packs or pieces
  const [busy, setBusy] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const units = unitsOf({ unitsPerPack: f.unitsPerPack });
  const packed = units > 1;
  const pack = packName({ packLabel: f.packLabel });

  // What each empty field would be worked out as (shown as its placeholder).
  const piece = (packVal) => (num(packVal) === null ? null : toPiecePrice(packVal, units));
  const whole = (pieceVal) => (num(pieceVal) === null ? null : toPackPrice(pieceVal, units));
  const auto = {
    cost: num(f.costPrice) !== null ? null : piece(f.costPack),
    costPack: num(f.costPack) !== null ? null : whole(f.costPrice),
    retail: num(f.retailPrice) !== null ? null : piece(f.packRetailPrice),
    retailPack: num(f.packRetailPrice) !== null ? null : whole(f.retailPrice),
    ws: num(f.wholesalePrice) !== null ? null : piece(f.packWholesalePrice),
    wsPack: num(f.packWholesalePrice) !== null ? null : whole(f.wholesalePrice),
  };
  const ph = (n, word) => (n === null ? '' : `${n}  (${word})`);

  // What will actually be saved.
  const costPiece = num(f.costPrice) ?? piece(f.costPack);
  const retailPiece = num(f.retailPrice) ?? piece(f.packRetailPrice);
  const retailPack = packed ? (num(f.packRetailPrice) ?? (retailPiece === null ? null : toPackPrice(retailPiece, units))) : null;
  const costPack = packed ? (num(f.costPack) ?? (costPiece === null ? null : toPackPrice(costPiece, units))) : null;
  const margin = (price, cost) => (price > 0 && cost > 0 ? Math.round(((price - cost) / cost) * 1000) / 10 : null);
  const mPiece = margin(retailPiece, costPiece);
  const mPack = packed ? margin(retailPack, costPack) : null;
  const costMismatch = packed && num(f.costPrice) !== null && num(f.costPack) !== null && Math.abs(toPiecePrice(f.costPack, units) - Number(f.costPrice)) > 0.005;

  const save = async (e) => {
    e.preventDefault();
    if (retailPiece === null) return toast('Enter a selling price (per piece or per pack)', 'err');
    if (costPiece === null) return toast('Enter a cost (per piece or per pack)', 'err');
    setBusy(true);
    const wsPiece = num(f.wholesalePrice) ?? piece(f.packWholesalePrice);
    const body = {
      name: f.name, sku: f.sku, barcode: f.barcode, category: f.category,
      costPrice: costPiece, retailPrice: retailPiece, wholesalePrice: wsPiece ?? 0,
      packRetailPrice: packed ? num(f.packRetailPrice) ?? 0 : 0,
      packWholesalePrice: packed ? num(f.packWholesalePrice) ?? 0 : 0,
      reorderLevel: Number(f.reorderLevel) || 0, unitsPerPack: units, packLabel: f.packLabel.trim(),
    };
    if (isNew) body.stock = packed && stockUnit === 'pack' ? toPieces(f.stock || 0, units) : Number(f.stock) || 0;
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

  const priceInput = (key, placeholder, required) => (
    <input type="number" min="0" step="any" inputMode="decimal" value={f[key]} onChange={set(key)} placeholder={placeholder} required={required} />
  );

  return (
    <Modal title={isNew ? 'Add product' : `Edit ${p.name}`} onClose={onClose} wide>
      <form onSubmit={save} className="grid2">
        <Field label="Name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="SKU" hint="Short unique code to identify this product, e.g. RICE-5KG"><input value={f.sku} onChange={set('sku')} required /></Field>
        <Field label="Barcode" hint="Scan it here, or leave blank"><input value={f.barcode} onChange={set('barcode')} /></Field>
        <Field label="Category"><input value={f.category} onChange={set('category')} /></Field>

        {/* Pack size first, so the price fields below know what a pack is */}
        <Field label="Pieces per pack" hint="e.g. 12 for a carton of 12. Leave 1 if it is only sold by the piece"><input type="number" min="1" step="1" value={f.unitsPerPack} onChange={set('unitsPerPack')} /></Field>
        <Field label="Pack name" hint='e.g. "ctn", "box", "bag"'><input value={f.packLabel} onChange={set('packLabel')} placeholder="ctn" maxLength={20} /></Field>

        {packed && (
          <p className="span2 hint bulk-explain">
            Enter the price per piece, per {pack}, or both. If you leave one empty it is worked out from the other
            ({pack} ÷ {units} for a piece, piece × {units} for a {pack}). A price you type for the {pack} is kept as its own
            price, so a {pack} can sell for less than {units} single pieces.
          </p>
        )}

        <Field label={`Cost per piece (GH₵)`} hint={packed ? undefined : undefined}>
          {priceInput('costPrice', ph(auto.cost, `${f.costPack} ÷ ${units}`), !packed || num(f.costPack) === null)}
        </Field>
        {packed && (
          <Field label={`Cost per ${pack} (GH₵)`} hint={costMismatch ? `${pack} ÷ ${units} = ${fmt(toPiecePrice(f.costPack, units))}, not the piece cost above. Profit and stock value use the piece cost.` : undefined}>
            {priceInput('costPack', ph(auto.costPack, `${f.costPrice} × ${units}`), false)}
          </Field>
        )}

        <Field label="Retail price per piece (GH₵)" hint={mPiece !== null ? `margin ${mPiece}%` : undefined}>
          {priceInput('retailPrice', ph(auto.retail, `${f.packRetailPrice} ÷ ${units}`), !packed || num(f.packRetailPrice) === null)}
        </Field>
        {packed && (
          <Field label={`Retail price per ${pack} (GH₵)`} hint={[auto.retailPack !== null ? `sells at ${money(auto.retailPack)} unless you set a ${pack} price` : null, mPack !== null ? `margin ${mPack}%` : null].filter(Boolean).join(' · ') || undefined}>
            {priceInput('packRetailPrice', ph(auto.retailPack, `${f.retailPrice} × ${units}`), false)}
          </Field>
        )}

        <Field label="Wholesale price per piece (GH₵)" hint="Leave empty to use the retail price">
          {priceInput('wholesalePrice', ph(auto.ws, `${f.packWholesalePrice} ÷ ${units}`), false)}
        </Field>
        {packed && (
          <Field label={`Wholesale price per ${pack} (GH₵)`} hint="Leave empty to use the wholesale piece price × pieces, or else the retail price">
            {priceInput('packWholesalePrice', ph(auto.wsPack, `${f.wholesalePrice} × ${units}`), false)}
          </Field>
        )}

        <Field label={packed ? 'Reorder level (pieces)' : 'Reorder level'} hint="Show a low-stock warning when stock drops to or below this number"><input type="number" min="0" step="any" value={f.reorderLevel} onChange={set('reorderLevel')} /></Field>
        {isNew && (
          <Field label={`Opening stock (${packed && stockUnit === 'pack' ? `${pack}s` : 'pieces'})`} hint={packed && stockUnit === 'pack' && Number(f.stock) > 0 ? `= ${toPieces(f.stock, units)} pieces` : undefined}>
            <input type="number" min="0" step="any" inputMode="decimal" value={f.stock} onChange={set('stock')} />
            {packed && (
              <div className="seg stock-unit" role="group" aria-label="Opening stock unit">
                <button type="button" className={stockUnit === 'pack' ? 'on' : ''} onClick={() => setStockUnit('pack')}>{pack}s</button>
                <button type="button" className={stockUnit === 'piece' ? 'on' : ''} onClick={() => setStockUnit('piece')}>pieces</button>
              </div>
            )}
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
