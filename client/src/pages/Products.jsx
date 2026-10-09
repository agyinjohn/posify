import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field, Modal, useToast } from '../ui.jsx';
import { fmt, qtyFmt } from '../format.js';

const blank = { name: '', sku: '', barcode: '', category: 'General', costPrice: '', retailPrice: '', wholesalePrice: '', reorderLevel: 0, stock: 0, unitsPerPack: 1, packLabel: '' };

export default function Products() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = useCallback(() => {
    api(`/products?all=1&q=${encodeURIComponent(q)}${low ? '&lowStock=1' : ''}`).then(setList).catch((e) => toast(e.message, 'err'));
  }, [q, low, toast]);
  useEffect(load, [load]);

  return (
    <div className="page">
      <div className="head"><h1>Products</h1><button className="primary" onClick={() => setEdit(blank)}>Add product</button></div>
      <div className="filters">
        <input className="search" placeholder="Search name, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th></th><th>Name</th><th>SKU</th><th>Category</th><th className="num">Cost</th><th className="num">Retail</th><th className="num">Wholesale</th><th className="num">In stock</th><th></th></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p._id} className={p.active ? '' : 'voided'}>
              <td>{p.image?.url ? <img className="thumb" src={p.image.url} alt="" /> : <span className="thumb none" />}</td>
              <td>{p.name}{!p.active && ' (inactive)'}</td><td>{p.sku}</td><td>{p.category}</td>
              <td className="num">{fmt(p.costPrice)}</td><td className="num">{fmt(p.retailPrice)}</td>
              <td className="num">{p.wholesalePrice ? fmt(p.wholesalePrice) : '–'}</td>
              <td className={`num${p.stock <= p.reorderLevel ? ' owes' : ''}`}>{qtyFmt(p.stock)}</td>
              <td className="acts"><button onClick={() => setEdit(p)}>Edit</button></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan="9" className="empty">No products yet. Add your first product.</td></tr>}
        </tbody>
      </table></div>
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
      costPrice: Number(f.costPrice) || 0, retailPrice: Number(f.retailPrice), wholesalePrice: Number(f.wholesalePrice) || 0,
      reorderLevel: Number(f.reorderLevel) || 0,
      unitsPerPack: Math.max(1, Number(f.unitsPerPack) || 1),
      packLabel: f.packLabel.trim(),
    };
    if (isNew) body.stock = Number(f.stock) || 0;
    try { await api(isNew ? '/products' : `/products/${p._id}`, { method: isNew ? 'POST' : 'PATCH', body }); toast('Product saved'); onSaved(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData(); form.append('image', file);
    try { const r = await api(`/products/${p._id}/image`, { method: 'POST', form }); setF({ ...f, image: r.image }); toast('Image uploaded'); }
    catch (err) { toast(err.message, 'err'); }
  };

  const toggleActive = async () => {
    try { await api(`/products/${p._id}`, { method: 'PATCH', body: { active: !p.active } }); toast(p.active ? 'Product hidden from sales' : 'Product active again'); onSaved(); }
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
        <Field label="Wholesale price (GH₵)" hint="Leave 0 to use the retail price"><input type="number" min="0" step="0.01" value={f.wholesalePrice} onChange={set('wholesalePrice')} /></Field>
        <Field label="Reorder level" hint="Flag as low when stock reaches this"><input type="number" min="0" step="any" value={f.reorderLevel} onChange={set('reorderLevel')} /></Field>
        <Field label="Units per pack" hint="e.g. 12 for a carton of 12. Leave 1 if sold by piece only">
          <input type="number" min="1" step="1" value={f.unitsPerPack} onChange={set('unitsPerPack')} />
        </Field>
        <Field label="Pack label" hint='e.g. "ctn", "box", "dozen". Leave blank if no pack unit'>
          <input value={f.packLabel} onChange={set('packLabel')} placeholder="ctn" maxLength={20} />
        </Field>
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
