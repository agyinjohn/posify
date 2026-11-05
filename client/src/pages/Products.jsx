import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { CardSkeleton, Field, Modal, RefreshIndicator, useToast } from '../ui.jsx';
import { COMMON_SIZES, fmt, productLabel, qtyFmt } from '../format.js';
import ProductImportModal from './ProductImport.jsx';
import { packName, packPriceFor, packSpecificPrice, toPackPrice, toPiecePrice, toPieces, unitsOf } from '../bulk.js';

const blank = { name: '', size: '', sku: '', barcode: '', category: 'General', costPrice: '', retailPrice: '', packRetailPrice: '', reorderLevel: 0, stock: 0, unitsPerPack: 1, packLabel: '' };

export default function Products() {
  const toast = useToast();
  const [list, setList] = useState(() => cacheGet('/products?all=1&q='));
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);

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
        <div className="toolbar-buttons">
          <button onClick={() => setImporting(true)}>Import</button>
          <button className="primary" onClick={() => setEdit(blank)}>Add product</button>
        </div>
      </div>

      <div className="product-grid">
        {list.map((p) => (
          <div key={p._id} className={`product-card${p.active ? '' : ' inactive'}`} onClick={() => setEdit(p)}>
            {p.image?.url
              ? <img className="product-card-img" src={p.image.url} alt="" loading="lazy" decoding="async" />
              : <div className="product-card-img placeholder" />}
            <div className="product-card-body">
              <div className="product-card-name">{p.name}{p.size && <span className="size-chip">{p.size}</span>}{!p.active && <span className="chip chip-muted">inactive</span>}</div>
              <div className="product-card-sku">{p.sku}{p.category && p.category !== 'General' ? ` · ${p.category}` : ''}</div>
              <div className="product-card-prices">
                {unitsOf(p) > 1 ? (
                  <>
                    <span className="product-card-price">{fmt(packPriceFor(p))}<small> per {packName(p)}</small></span>
                    <span className="product-card-ws">{fmt(p.retailPrice)} per piece</span>
                  </>
                ) : (
                  <>
                    <span className="product-card-price">{fmt(p.retailPrice)}</span>
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

      {importing && <ProductImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
      {edit && (
        <ProductForm
          key={edit._id || `new-${edit.name}-${edit.size}`}
          p={edit}
          sizes={[...new Set([...COMMON_SIZES, ...(list || []).map((x) => x.size).filter(Boolean)])]}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
          // Same product in another size: start a new product with the details copied and a blank size, SKU and stock.
          onAddSize={(from) => setEdit({ ...blank, ...from, _id: undefined, size: '', sku: '', barcode: '', stock: 0, image: undefined, active: true })}
        />
      )}
    </div>
  );
}

// Cost and selling prices for a product that comes in cartons/boxes: the owner can type the price per piece, per
// carton, or both. Leave one empty and it is worked out from the other (carton / pieces per carton, or piece x
// pieces per carton). A carton price typed here is kept as its own price, so cartons can sell for less than the
// pieces added up; a piece price with no carton price just sells cartons at pieces x piece price.
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const money = (n) => (n === null || n === undefined ? undefined : fmt(n));

function ProductForm({ p, sizes = COMMON_SIZES, onClose, onSaved, onAddSize }) {
  const toast = useToast();
  const isNew = !p._id;
  const [f, setF] = useState(() => ({
    ...blank, ...p, barcode: p.barcode || '',
    costPrice: p.costPrice ?? '', retailPrice: p.retailPrice ?? '',
    costPack: '',
    // The one pack price. For products saved before, this shows their old wholesale carton price, which is what a
    // carton sells at today; saving stores it as the pack price.
    packRetailPrice: packSpecificPrice(p) ?? '', // also carried over when adding another size of a product
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
    const body = {
      name: f.name, size: (f.size || '').trim(), sku: f.sku, barcode: f.barcode, category: f.category,
      costPrice: costPiece, retailPrice: retailPiece,
      packRetailPrice: packed ? num(f.packRetailPrice) ?? 0 : 0,
      // Retired: the pack price is the wholesale price. Clearing these stops older products' wholesale fields
      // from overriding the price typed here.
      wholesalePrice: 0, packWholesalePrice: 0,
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
    <Modal title={isNew ? (p.name ? `Add another size of ${p.name}` : 'Add product') : `Edit ${productLabel(p)}`} onClose={onClose} wide>
      <form onSubmit={save} className="grid2">
        <Field label="Name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Size (optional)" hint="Only for products that come in sizes, e.g. Small or 500ml. Each size is added as its own product.">
          <input value={f.size || ''} onChange={set('size')} list="product-sizes" maxLength={30} placeholder="No size" autoComplete="off" />
          <datalist id="product-sizes">{sizes.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="SKU" hint="Short unique code to identify this product, e.g. RICE-5KG"><input value={f.sku} onChange={set('sku')} required /></Field>
        <Field label="Barcode" hint="Scan it here, or leave blank"><input value={f.barcode} onChange={set('barcode')} /></Field>
        <Field label="Category"><input value={f.category} onChange={set('category')} /></Field>

        {/* Pack size first, so the price fields below know what a pack is */}
        <Field label="Pieces per pack" hint="e.g. 12 for a carton of 12. Leave 1 if it is only sold by the piece"><input type="number" min="1" step="1" value={f.unitsPerPack} onChange={set('unitsPerPack')} /></Field>
        <Field label="Pack name" hint='e.g. "ctn", "box", "bag"'><input value={f.packLabel} onChange={set('packLabel')} placeholder="ctn" maxLength={20} /></Field>

        {packed && (
          <p className="span2 hint bulk-explain">
            A customer buying single pieces pays the <strong>piece price</strong> (retail); a customer buying a full {pack} pays
            the <strong>{pack} price</strong> (wholesale). Enter either or both: an empty one is worked out from the other
            ({pack} ÷ {units} for a piece, piece × {units} for a {pack}).
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

        <Field label={packed ? 'Selling price per piece (GH₵)' : 'Selling price (GH₵)'} hint={[packed ? 'Retail: what a customer pays for one piece' : null, mPiece !== null ? `margin ${mPiece}%` : null].filter(Boolean).join(' · ') || undefined}>
          {priceInput('retailPrice', ph(auto.retail, `${f.packRetailPrice} ÷ ${units}`), !packed || num(f.packRetailPrice) === null)}
        </Field>
        {packed && (
          <Field label={`Selling price per ${pack} (GH₵)`} hint={[`Wholesale: what a customer pays for a full ${pack}`, auto.retailPack !== null ? `${money(auto.retailPack)} unless you set it` : null, mPack !== null ? `margin ${mPack}%` : null].filter(Boolean).join(' · ')}>
            {priceInput('packRetailPrice', ph(auto.retailPack, `${f.retailPrice} × ${units}`), false)}
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
          {!isNew && onAddSize && <button type="button" onClick={() => onAddSize(p)}>Add another size</button>}
          <button className="primary" disabled={busy}>Save product</button>
        </div>
      </form>
      {!isNew && <p className="hint">Stock changes go through the Stock page so every change has a record.</p>}
    </Modal>
  );
}
