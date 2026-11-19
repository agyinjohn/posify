import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { cacheGet, cacheInvalidatePrefix, swrFetch } from '../cache.js';
import { CardSkeleton, Field, Modal, RefreshIndicator, useToast } from '../ui.jsx';
import { COMMON_COLORS, COMMON_SIZES, fmt, productLabel, qtyFmt } from '../format.js';
import { CLOTHING_SIZES, compareSizes, groupProducts, uniqueSorted } from '../variants.js';
import ProductImportModal from './ProductImport.jsx';
import DataTable from '../DataTable.jsx';
import LabelPrinter from '../LabelPrinter.jsx';
import { LayoutGrid, List, Pencil, Tag } from 'lucide-react';
import { packName, packPriceFor, packSpecificPrice, toPackPrice, toPiecePrice, toPieces, unitsOf } from '../bulk.js';

const blank = { name: '', size: '', color: '', sku: '', barcode: '', category: 'General', costPrice: '', retailPrice: '', packRetailPrice: '', reorderLevel: 0, stock: 0, unitsPerPack: 1, packLabel: '' };

export default function Products() {
  const toast = useToast();
  const [list, setList] = useState(() => cacheGet('/products?all=1&q='));
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const nav = useLocation();
  useEffect(() => { if (nav.state?.q) setQ(nav.state.q); }, [nav.state]); // search handed over from the top bar
  const [low, setLow] = useState(false);
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);
  const [styleKey, setStyleKey] = useState(null); // a product with sizes/colours, opened to see them all
  const [labels, setLabels] = useState(null); // products to print barcode labels for ([] = choose in the window)
  // List (table) or cards; remembered on this device.
  const [view, setViewState] = useState(() => { try { return localStorage.getItem('pos_products_view') || 'list'; } catch { return 'list'; } });
  const setView = (v) => { setViewState(v); try { localStorage.setItem('pos_products_view', v); } catch { /* private mode */ } };

  const load = useCallback(() => {
    // The table searches and filters on its own, so it always loads the whole catalogue.
    const key = view === 'list' ? '/products?all=1&q=' : `/products?all=1&q=${encodeURIComponent(q)}${low ? '&lowStock=1' : ''}`;
    swrFetch(key, { onData: setList, onRefreshing: setRefreshing, ttlMs: 60_000 })
      .catch((e) => toast(e.message, 'err'));
  }, [q, low, view, toast]);
  useEffect(() => { load(); }, [load]);

  if (list === null) return <div className="page"><CardSkeleton count={12} /></div>;
  const items = groupProducts(list);
  const openStyle = styleKey && items.find((i) => i.key === styleKey);
  const knownSizes = [...new Set([...COMMON_SIZES, ...list.map((x) => x.size).filter(Boolean)])];
  const knownColors = uniqueSorted([...COMMON_COLORS, ...list.map((x) => x.color)], (a, b) => a.localeCompare(b));
  const lowCount = list.filter((p) => p.active && p.stock <= p.reorderLevel).length;
  const toggle = (
    <div className="view-toggle" role="group" aria-label="View">
      <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List" aria-pressed={view === 'list'}><List size={17} /></button>
      <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="Cards" aria-pressed={view === 'grid'}><LayoutGrid size={17} /></button>
    </div>
  );
  const setActive = async (rows, active, clear) => {
    try {
      for (const p of rows) if (p.active !== active) await api(`/products/${p._id}`, { method: 'PATCH', body: { active } });
      cacheInvalidatePrefix('/products'); toast(`${rows.length} product${rows.length === 1 ? '' : 's'} ${active ? 'active' : 'hidden from sales'}`); clear(); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const stockState = (p) => (p.stock <= 0 ? 'out' : p.stock <= p.reorderLevel ? 'low' : 'in');
  const categories = [...new Set(list.map((p) => p.category || 'General'))].sort();
  const columns = [
    { key: 'name', label: 'Product', value: (p) => productLabel(p), render: (p) => (
      <div className="cell-thumb">
        {p.image?.url ? <img src={p.image.url} alt="" loading="lazy" /> : <span className="ph">{p.name.charAt(0).toUpperCase()}</span>}
        <span><strong>{p.name}{[p.size, p.color].filter(Boolean).map((t) => <span key={t} className="size-chip">{t}</span>)}</strong>{p.barcode && <small>{p.barcode}</small>}</span>
      </div>
    ) },
    { key: 'sku', label: 'SKU', className: 'muted-cell' },
    { key: 'category', label: 'Category', value: (p) => p.category || 'General' },
    { key: 'retailPrice', label: 'Price', align: 'num', render: (p) => (
      <span><strong>{fmt(p.retailPrice)}</strong>{unitsOf(p) > 1 && <small className="cell-sub">{fmt(packPriceFor(p))} / {packName(p)}</small>}</span>
    ), exportValue: (p) => p.retailPrice },
    { key: 'pack', label: 'Pack price', align: 'num', hidden: true, value: (p) => (unitsOf(p) > 1 ? packPriceFor(p) : '') },
    { key: 'units', label: 'Pieces per pack', align: 'num', hidden: true, value: (p) => (unitsOf(p) > 1 ? unitsOf(p) : '') },
    { key: 'costPrice', label: 'Cost', align: 'num', className: 'muted-cell', render: (p) => fmt(p.costPrice) },
    { key: 'stock', label: 'In stock', align: 'num', render: (p) => (
      <span className={`stock-badge${stockState(p) === 'out' ? ' out' : stockState(p) === 'low' ? ' low' : ''}`}>{p.stock <= 0 ? 'Out' : qtyFmt(p.stock)}</span>
    ) },
    { key: 'active', label: 'Status', value: (p) => (p.active ? 'Active' : 'Hidden'), render: (p) => <span className={`badge ${p.active ? 'badge-green' : 'badge-plain'}`}>{p.active ? 'Active' : 'Hidden'}</span> },
    { key: 'acts', label: '', sortable: false, export: false, render: (p) => (
      <div className="cell-actions"><button className="icon-act" onClick={(e) => { e.stopPropagation(); setEdit(p); }} aria-label={`Edit ${productLabel(p)}`}><Pencil size={15} /></button></div>
    ) },
  ];
  const filters = [
    { key: 'category', label: 'All categories', options: categories.map((c) => [c, c]), test: (p, v) => (p.category || 'General') === v },
    { key: 'stock', label: 'Any stock', options: [['in', 'In stock'], ['low', 'Running low'], ['out', 'Out of stock']], test: (p, v) => stockState(p) === v },
    { key: 'active', label: 'Active and hidden', options: [['yes', 'Active'], ['no', 'Hidden']], test: (p, v) => (v === 'yes' ? p.active : !p.active) },
  ];

  if (view === 'list') {
    return (
      <div className="page page-wide">
        <RefreshIndicator refreshing={refreshing} />
        <div className="stat-row">
          <div className="stat-chip"><span>Products</span><strong>{list.length}</strong></div>
          <div className="stat-chip warn"><span>Low or out</span><strong>{lowCount}</strong></div>
          <div className="stat-chip key"><span>Stock value (cost)</span><strong>{fmt(list.filter((p) => p.active).reduce((t, p) => t + Math.max(p.stock, 0) * p.costPrice, 0))}</strong></div>
        </div>
        <DataTable
          title="Products" exportName="products" rows={list} columns={columns} filters={filters}
          searchPlaceholder="Search name, SKU or barcode" searchText={(p) => `${productLabel(p)} ${p.sku} ${p.barcode || ''} ${p.category || ''}`}
          initialSearch={nav.state?.q || ''} initialSort={{ key: 'name', dir: 'asc' }}
          onRowClick={setEdit} rowClass={(p) => (p.active ? '' : 'muted-row')} emptyText="No products yet. Add your first product."
          selectable bulkActions={(rows, clear) => (
            <>
              <button onClick={() => setActive(rows, false, clear)}>Hide from sales</button>
              <button onClick={() => setActive(rows, true, clear)}>Make active</button>
              <button onClick={() => setLabels(rows)}><Tag size={14} /> Print labels</button>
            </>
          )}
          actions={<>{toggle}<button onClick={() => setLabels([])}><Tag size={15} /> Labels</button><button onClick={() => setImporting(true)}>Import</button><button className="primary" onClick={() => setEdit(blank)}>Add product</button></>}
        />
        {importing && <ProductImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
        {labels && <LabelPrinter products={labels} catalogue={list} onClose={() => setLabels(null)} />}
        {edit && (
          <ProductForm key={edit._id || 'new'} onLabel={(p) => { setEdit(null); setLabels([p]); }} p={edit} sizes={knownSizes} colors={knownColors}
            onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }}
            onAddSize={(from) => setEdit({ ...blank, ...from, _id: undefined, size: '', color: '', sku: '', barcode: '', stock: 0, image: undefined, active: true,
              addingTo: items.find((i) => i.type === 'style' && i.variants.some((v) => v._id === from._id)) || { variants: [from] } })} />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <RefreshIndicator refreshing={refreshing} />
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <input className="search" placeholder="Search name, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
          {lowCount > 0 && <span className="chip chip-red">{lowCount} low</span>}
          {list.length > 0 && <span className="chip">{items.length} product{items.length !== 1 ? 's' : ''}</span>}
        </div>
        <div className="toolbar-buttons">
          {toggle}
          <button onClick={() => setLabels([])}><Tag size={15} /> Labels</button>
          <button onClick={() => setImporting(true)}>Import</button>
          <button className="primary" onClick={() => setEdit(blank)}>Add product</button>
        </div>
      </div>

      <div className="product-grid">
        {items.map((item) => (item.type === 'style' ? (
          <div key={item.key} className={`product-card${item.variants.some((v) => v.active) ? '' : ' inactive'}`} onClick={() => setStyleKey(item.key)}>
            {item.image?.url
              ? <img className="product-card-img" src={item.image.url} alt="" loading="lazy" decoding="async" />
              : <div className="product-card-img placeholder" />}
            <div className="product-card-body">
              <div className="product-card-name">{item.name}</div>
              <div className="product-card-variants">
                {item.sizes.length > 0 && <span>{item.sizes.join(' · ')}</span>}
                {item.colors.length > 0 && <span>{item.colors.join(' · ')}</span>}
              </div>
              <div className="product-card-prices">
                <span className="product-card-price">{item.minPrice !== item.maxPrice && <small>from </small>}{fmt(item.minPrice)}</span>
                <span className="product-card-ws">{item.variants.length} size{item.variants.length === 1 ? '' : 's'}/colour{item.variants.length === 1 ? '' : 's'}</span>
              </div>
              <div className="product-card-footer">
                <span className={`stock-badge${item.stock <= 0 ? ' out' : item.variants.some((v) => v.active && v.stock <= v.reorderLevel) ? ' low' : ''}`}>
                  {item.stock <= 0 ? 'Out of stock' : `${qtyFmt(item.stock)} in stock`}
                </span>
                {item.category && item.category !== 'General' && <span className="product-card-cost">{item.category}</span>}
              </div>
            </div>
          </div>
        ) : (() => { const p = item.product; return (
          <div key={p._id} className={`product-card${p.active ? '' : ' inactive'}`} onClick={() => setEdit(p)}>
            {p.image?.url
              ? <img className="product-card-img" src={p.image.url} alt="" loading="lazy" decoding="async" />
              : <div className="product-card-img placeholder" />}
            <div className="product-card-body">
              <div className="product-card-name">{p.name}{[p.size, p.color].filter(Boolean).map((t) => <span key={t} className="size-chip">{t}</span>)}{!p.active && <span className="chip chip-muted">inactive</span>}</div>
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
        ); })()))}
        {list.length === 0 && (
          <div className="product-grid-empty">
            {q || low ? 'No products match your filters.' : 'No products yet. Add your first product.'}
          </div>
        )}
      </div>

      {importing && <ProductImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
      {labels && <LabelPrinter products={labels} catalogue={list} onClose={() => setLabels(null)} />}
      {openStyle && !edit && (
        <StyleView style={openStyle} onClose={() => setStyleKey(null)} onEdit={(v) => setEdit(v)} onChanged={load}
          onLabels={(vs) => { setStyleKey(null); setLabels(vs); }}
          onAddMore={() => setEdit({ ...blank, ...openStyle.variants[0], _id: undefined, size: '', color: '', sku: '', barcode: '', stock: 0, image: undefined, active: true, addingTo: openStyle })} />
      )}
      {edit && (
        <ProductForm
          key={edit._id || `new-${edit.name}-${edit.size}-${edit.addingTo ? 'more' : ''}`}
          onLabel={(p) => { setEdit(null); setLabels([p]); }}
          p={edit}
          sizes={knownSizes}
          colors={knownColors}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
          // More sizes/colours of this product: the details are copied; only the new sizes, colours and stock are asked for.
          onAddSize={(from) => setEdit({ ...blank, ...from, _id: undefined, size: '', color: '', sku: '', barcode: '', stock: 0, image: undefined, active: true,
            addingTo: items.find((i) => i.type === 'style' && i.variants.some((v) => v._id === from._id)) || { variants: [from] } })}
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

const comboKey = (size, color) => `${(size || '').trim().toLowerCase()}|${(color || '').trim().toLowerCase()}`;

// Type a value and press Enter (or comma), or tap a suggestion: each becomes a removable chip.
function ChipsInput({ values, onChange, suggestions = [], quick = [], placeholder, listId, label }) {
  const [text, setText] = useState('');
  const has = (v) => values.some((x) => x.toLowerCase() === v.toLowerCase());
  const addValue = (raw) => {
    const parts = String(raw).split(',').map((t) => t.trim()).filter(Boolean).map((t) => t.slice(0, 30));
    const next = [...values]; parts.forEach((t) => { if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t); });
    onChange(next); setText('');
  };
  return (
    <div className="chips-input">
      <div className="chips">
        {values.map((v) => (
          <span key={v} className="chip-tag">{v}<button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>×</button></span>
        ))}
      </div>
      <div className="chips-entry">
        <input value={text} list={listId} placeholder={placeholder} aria-label={label} maxLength={60} autoComplete="off"
          onChange={(e) => { const t = e.target.value; if (t.endsWith(',')) addValue(t); else setText(t); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) addValue(text); } }} />
        <button type="button" onClick={() => text.trim() && addValue(text)} disabled={!text.trim()}>Add</button>
        <datalist id={listId}>{suggestions.map((x) => <option key={x} value={x} />)}</datalist>
      </div>
      {quick.some((q) => !has(q)) && (
        <div className="chips-quick">{quick.filter((q) => !has(q)).map((q) => <button type="button" key={q} onClick={() => addValue(q)}>+ {q}</button>)}</div>
      )}
    </div>
  );
}

// Every size and colour of one product: tap one to edit it, set one price for all, or add more sizes/colours.
function StyleView({ style, onClose, onEdit, onAddMore, onChanged, onLabels }) {
  const toast = useToast();
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const setAll = async (e) => {
    e.preventDefault();
    const body = {};
    if (price !== '') body.retailPrice = Number(price);
    if (cost !== '') body.costPrice = Number(cost);
    if (!Object.keys(body).length) return;
    setBusy(true);
    try {
      for (const v of style.variants) await api(`/products/${v._id}`, { method: 'PATCH', body });
      cacheInvalidatePrefix('/products'); toast(`Updated ${style.variants.length} sizes/colours`); setPrice(''); setCost(''); onChanged();
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={style.name} onClose={onClose} wide>
      <p className="hint style-sum">{style.variants.length} sizes/colours · {qtyFmt(style.stock)} in stock{style.category && style.category !== 'General' ? ` · ${style.category}` : ''}</p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Size</th><th>Colour</th><th>SKU</th><th className="num">Price</th><th className="num">In stock</th></tr></thead>
          <tbody>
            {style.variants.map((v) => (
              <tr key={v._id} className={`clickable${v.active ? '' : ' muted-row'}`} onClick={() => onEdit(v)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onEdit(v)}>
                <td><strong>{v.size || '—'}</strong></td>
                <td>{v.color || '—'}</td>
                <td className="muted-cell">{v.sku}{!v.active && ' · hidden'}</td>
                <td className="num">{fmt(v.retailPrice)}</td>
                <td className={`num${v.stock <= v.reorderLevel ? ' owes' : ''}`}>{qtyFmt(v.stock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="style-setall" onSubmit={setAll}>
        <Field label="Selling price for all (GH₵)"><input type="number" min="0" step="any" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="unchanged" /></Field>
        <Field label="Cost for all (GH₵)"><input type="number" min="0" step="any" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="unchanged" /></Field>
        <button disabled={busy || (price === '' && cost === '')}>{busy ? 'Saving…' : 'Apply to all'}</button>
      </form>
      <div className="actions">
        {onLabels && <button onClick={() => onLabels(style.variants.filter((v) => v.active))}><Tag size={15} /> Print labels</button>}
        <button className="primary" onClick={onAddMore}>Add sizes or colours</button>
      </div>
      <p className="hint">Each size/colour has its own stock: change stock on the Stock page.</p>
    </Modal>
  );
}

function ProductForm({ p, sizes = COMMON_SIZES, colors = COMMON_COLORS, onClose, onSaved, onAddSize, onLabel }) {
  const toast = useToast();
  const isNew = !p._id;
  const adding = p.addingTo || null; // adding more sizes/colours to an existing product
  const [multi, setMulti] = useState(Boolean(adding));
  const [sizeList, setSizeList] = useState([]);
  const [colorList, setColorList] = useState([]);
  const [comboStock, setComboStock] = useState({});
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

  // Sizes x colours, minus the ones this product already has.
  const have = new Set((adding?.variants || []).map((v) => comboKey(v.size, v.color)));
  const combos = [];
  for (const sz of sizeList.length ? [...sizeList].sort(compareSizes) : ['']) {
    for (const co of colorList.length ? colorList : ['']) {
      if (sz || co) combos.push({ size: sz, color: co, key: comboKey(sz, co), exists: have.has(comboKey(sz, co)) });
    }
  }
  const newCombos = combos.filter((c) => !c.exists);

  const saveVariants = async () => {
    if (newCombos.length === 0) return toast(combos.length ? 'Those sizes/colours already exist' : 'Add at least one size or colour', 'err');
    const toPcs = (v) => (packed && stockUnit === 'pack' ? toPieces(v || 0, units) : Number(v) || 0);
    const body = {
      base: { name: f.name, sku: f.sku, category: f.category, costPrice: costPiece, retailPrice: retailPiece,
        packRetailPrice: packed ? num(f.packRetailPrice) ?? 0 : 0, reorderLevel: Number(f.reorderLevel) || 0, unitsPerPack: units, packLabel: f.packLabel.trim() },
      combos: newCombos.map((c) => ({ size: c.size, color: c.color, stock: toPcs(comboStock[c.key]) })),
    };
    setBusy(true);
    try {
      const created = await api('/products/variants', { method: 'POST', body });
      cacheInvalidatePrefix('/products');
      if (pendingImage && created[0]) {
        const form = new FormData(); form.append('image', pendingImage);
        await api(`/products/${created[0]._id}/image`, { method: 'POST', form }).catch(() => {});
      }
      toast(`${created.length} size${created.length === 1 ? '' : 's'}/colour${created.length === 1 ? '' : 's'} added`); onSaved();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (retailPiece === null) return toast('Enter a selling price (per piece or per pack)', 'err');
    if (costPiece === null) return toast('Enter a cost (per piece or per pack)', 'err');
    if (multi) return saveVariants();
    setBusy(true);
    const body = {
      name: f.name, size: (f.size || '').trim(), color: (f.color || '').trim(), sku: f.sku, barcode: f.barcode, category: f.category,
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
    <Modal title={adding ? `Add sizes or colours: ${p.name}` : isNew ? 'Add product' : `Edit ${productLabel(p)}`} onClose={onClose} wide>
      <form onSubmit={save} className="grid2">
        <Field label="Name"><input value={f.name} onChange={set('name')} required readOnly={Boolean(adding)} /></Field>
        {isNew && !adding && (
          <label className="check span2 multi-toggle">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            <span>Comes in sizes or colours <small>(e.g. clothes, shoes)</small></span>
          </label>
        )}
        {!multi && (
          <>
            <Field label="Size (optional)">
              <input value={f.size || ''} onChange={set('size')} list="product-sizes" maxLength={30} placeholder="No size" autoComplete="off" />
              <datalist id="product-sizes">{sizes.map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
            <Field label="Colour (optional)">
              <input value={f.color || ''} onChange={set('color')} list="product-colors" maxLength={30} placeholder="No colour" autoComplete="off" />
              <datalist id="product-colors">{colors.map((x) => <option key={x} value={x} />)}</datalist>
            </Field>
          </>
        )}
        {multi && (
          <div className="span2 variant-box">
            <Field label="Sizes">
              <ChipsInput values={sizeList} onChange={setSizeList} suggestions={sizes} quick={CLOTHING_SIZES.slice(1, 7)} placeholder="Type a size, e.g. M or 42" listId="v-sizes" label="Add a size" />
            </Field>
            <Field label="Colours">
              <ChipsInput values={colorList} onChange={setColorList} suggestions={colors} placeholder="Type a colour, e.g. Red" listId="v-colors" label="Add a colour" />
            </Field>
            {combos.length > 0 && (
              <div className="combo-list">
                <div className="combo-head">
                  <span>{newCombos.length} to add{combos.length > newCombos.length ? ` · ${combos.length - newCombos.length} already there` : ''}</span>
                  <span>Opening stock{packed ? ` (${stockUnit === 'pack' ? `${pack}s` : 'pieces'})` : ''}</span>
                </div>
                {combos.map((c) => (
                  <div key={c.key} className={`combo-row${c.exists ? ' exists' : ''}`}>
                    <span>{[c.size, c.color].filter(Boolean).join(' · ')}</span>
                    {c.exists ? <small>already added</small> : (
                      <input type="number" min="0" step="any" inputMode="numeric" aria-label={`Opening stock for ${[c.size, c.color].filter(Boolean).join(' ')}`}
                        value={comboStock[c.key] ?? ''} placeholder="0" onChange={(e) => setComboStock((m) => ({ ...m, [c.key]: e.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <Field label={multi ? 'SKU start (optional)' : 'SKU'} hint={multi ? 'Each size/colour gets its own code, e.g. DRESS-M-RED' : 'Short unique code to identify this product, e.g. RICE-5KG'}>
          <input value={f.sku} onChange={set('sku')} required={!multi} />
        </Field>
        {!multi && <Field label="Barcode" hint="Scan it here, or leave blank"><input value={f.barcode} onChange={set('barcode')} /></Field>}
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
        {isNew && !multi && (
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
        {multi && packed && (
          <div className="seg stock-unit span2" role="group" aria-label="Opening stock unit">
            <button type="button" className={stockUnit === 'pack' ? 'on' : ''} onClick={() => setStockUnit('pack')}>Stock in {pack}s</button>
            <button type="button" className={stockUnit === 'piece' ? 'on' : ''} onClick={() => setStockUnit('piece')}>Stock in pieces</button>
          </div>
        )}
        {isNew && !(adding && adding.image) && (
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
          {!isNew && onAddSize && <button type="button" onClick={() => onAddSize(p)}>Add sizes or colours</button>}
          {!isNew && onLabel && <button type="button" onClick={() => onLabel(p)}><Tag size={15} /> Print label</button>}
          <button className="primary" disabled={busy}>{multi ? `Add ${newCombos.length || ''} size${newCombos.length === 1 ? '' : 's'}/colour${newCombos.length === 1 ? '' : 's'}`.replace('  ', ' ') : 'Save product'}</button>
        </div>
      </form>
      {!isNew && <p className="hint">Stock changes go through the Stock page so every change has a record.</p>}
    </Modal>
  );
}
