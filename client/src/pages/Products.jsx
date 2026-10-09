import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { CardSkeleton, Field, Modal, RefreshIndicator, useToast } from '../ui.jsx';
import { fmt, qtyFmt } from '../format.js';

const blank = { name: '', sku: '', barcode: '', category: 'General', costPrice: '', retailPrice: '', wholesalePrice: '', reorderLevel: 0, stock: 0, unitsPerPack: 1, packLabel: '' };

export default function Products() {
  const toast = useToast();
  const [list, setList] = useState(null);
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
              ? <img className="product-card-img" src={p.image.url} alt="" />
              : <div className="product-card-img placeholder" />}
            <div className="product-card-body">
              <div className="product-card-name">{p.name}{!p.active && <span className="chip chip-muted">inactive</span>}</div>
              <div className="product-card-sku">{p.sku}{p.category !== 'General' ? ` · ${p.category}` : ''}</div>
              <div className="product-card-prices">
                <span className="product-card-price">{fmt(p.retailPrice)}</span>
                {p.wholesalePrice > 0 && <span className="product-card-ws">WS {fmt(p.wholesalePrice)}</span>}
              </div>
              <div className="product-card-footer">
                <span className={`stock-badge${p.stock <= 0 ? ' out' : p.stock <= p.reorderLevel ? ' low' : ''}`}>
                  {p.stock <= 0 ? 'Out of stock' : `${qtyFmt(p.stock)} in stock`}
                </span>
                <span className="product-card-cost">Cost {fmt(p.costPrice)}</span>
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
  const [f, setF] = useState({ ...blank, ...p, barcode: p.barcode || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = {
      name: f.name, sku: f.sku, barcode: f.barcode, category: f.category,
      costPrice: Number(f.costPrice) || 0, retailPrice: Number(f.retailPrice),
      wholesalePrice: Number(f.wholesalePrice) || 0, reorderLevel: Number(f.reorderLevel) || 0,
      unitsPerPack: Math.max(1, Number(f.unitsPerPack) || 1), packLabel: f.packLabel.trim(),
    };
    if (isNew) body.stock = Number(f.stock) || 0;
    try { await api(isNew ? '/products' : `/products/${p._id}`, { method: isNew ? 'POST' : 'PATCH', body }); cacheInvalidatePrefix('/products'); toast('Product saved'); onSaved(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
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
        <Field label="SKU"><input value={f.sku} onChange={set('sku')} required /></Field>
        <Field label="Barcode" hint="Scan it here, or leave blank"><input value={f.barcode} onChange={set('barcode')} /></Field>
        <Field label="Category"><input value={f.category} onChange={set('category')} /></Field>
        <Field label="Cost price (GH₵)"><input type="number" min="0" step="0.01" value={f.costPrice} onChange={set('costPrice')} required /></Field>
        <Field label="Retail price (GH₵)"><input type="number" min="0" step="0.01" value={f.retailPrice} onChange={set('retailPrice')} required /></Field>
        <Field label="Wholesale price (GH₵)" hint="Leave 0 to use retail price"><input type="number" min="0" step="0.01" value={f.wholesalePrice} onChange={set('wholesalePrice')} /></Field>
        <Field label="Reorder level"><input type="number" min="0" step="any" value={f.reorderLevel} onChange={set('reorderLevel')} /></Field>
        <Field label="Units per pack" hint="e.g. 12 for a carton. Leave 1 if sold by piece only"><input type="number" min="1" step="1" value={f.unitsPerPack} onChange={set('unitsPerPack')} /></Field>
        <Field label="Pack label" hint='e.g. "ctn", "box". Leave blank if no pack unit'><input value={f.packLabel} onChange={set('packLabel')} placeholder="ctn" maxLength={20} /></Field>
        {isNew && <Field label="Opening stock"><input type="number" min="0" step="any" value={f.stock} onChange={set('stock')} /></Field>}
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
