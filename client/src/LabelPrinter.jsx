import { useMemo, useState } from 'react';
import { Minus, Plus, Printer, Search, X } from 'lucide-react';
import { Field, Modal, useToast } from './ui.jsx';
import { SHOP_NAME, fmt, productLabel, qtyFmt } from './format.js';
import { packName, packPriceFor, unitsOf } from './bulk.js';
import { LABEL_SIZES, barcodeFits, isSheet, labelCode, labelsDocument, layoutLabels, sizeById } from './labels.js';

/**
 * Print barcode labels for products: on A4 sticker sheets or a label-printer roll. Each label shows the name,
 * the price and a Code 128 barcode of the product's barcode, or its SKU when it has none (the till scans both).
 */
const SETTINGS_KEY = 'pos_label_settings';
const loadSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } };

export default function LabelPrinter({ products = [], catalogue = [], onClose }) {
  const toast = useToast();
  const saved = loadSettings();
  const [showPrice, setShowPrice] = useState(saved.showPrice ?? true);
  const [rows, setRows] = useState(() => products.map((p) => ({ p, copies: 1, price: saved.showPrice ?? true })));
  const [sizeId, setSizeId] = useState(saved.sizeId || 'a4-3x8');
  const [showShop, setShowShop] = useState(saved.showShop ?? true);
  const [priceMode, setPriceMode] = useState(saved.priceMode || 'piece'); // piece | pack
  const [skip, setSkip] = useState(0);
  const [q, setQ] = useState('');
  const size = sizeById(sizeId);

  const remember = (patch) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sizeId, showPrice, showShop, priceMode, ...patch })); } catch { /* private mode */ } };
  const opts = {
    shopName: SHOP_NAME, showShop, nameOf: productLabel,
    showPrice: (p) => rows.find((r) => r.p._id === p._id)?.price ?? showPrice,
    priceOf: (p) => (priceMode === 'pack' && unitsOf(p) > 1 ? `${fmt(packPriceFor(p))} / ${packName(p)}` : fmt(p.retailPrice)),
  };
  const items = rows.map((r) => ({ product: r.p, copies: r.copies }));
  const pages = useMemo(() => layoutLabels(items, size, { skip }), [items, size, skip]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((t, r) => t + (Math.floor(Number(r.copies)) || 0), 0);
  const tooLong = rows.filter((r) => !barcodeFits(labelCode(r.p), size));
  const anyPacked = rows.some((r) => unitsOf(r.p) > 1);
  const preview = useMemo(() => labelsDocument(pages.slice(0, isSheet(size) ? 1 : 3), size, opts, { autoPrint: false }),
    [pages, size, rows, showShop, priceMode, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = q.trim()
    ? catalogue.filter((p) => p.active !== false && !rows.some((r) => r.p._id === p._id)
      && `${productLabel(p)} ${p.sku} ${p.barcode || ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];
  const setCopies = (id, v) => setRows((rs) => rs.map((r) => (r.p._id === id ? { ...r, copies: Math.max(0, Math.min(999, Math.floor(Number(v)) || 0)) } : r)));

  const print = () => {
    if (!total) return toast('Choose how many labels to print', 'err');
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups for this site to print labels', 'err');
    w.document.write(labelsDocument(pages, size, opts));
    w.document.close();
    remember({});
  };

  return (
    <Modal title="Print barcode labels" onClose={onClose} wide>
      <div className="lp">
        <div className="lp-left">
          <div className="lp-add">
            <Search size={16} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a product: name, SKU or barcode" aria-label="Add a product" />
            {matches.length > 0 && (
              <ul className="lp-matches">
                {matches.map((p) => (
                  <li key={p._id}><button type="button" onClick={() => { setRows((rs) => [...rs, { p, copies: 1, price: showPrice }]); setQ(''); }}>
                    <strong>{productLabel(p)}</strong><small>{p.sku} · {qtyFmt(p.stock)} in stock</small>
                  </button></li>
                ))}
              </ul>
            )}
          </div>

          {rows.length === 0 ? <p className="lp-empty">Add the products you want labels for.</p> : (
            <ul className="lp-rows">
              {rows.map(({ p, copies, price }) => (
                <li key={p._id}>
                  <span className="lp-name"><strong>{productLabel(p)}</strong><small>{labelCode(p)}{!p.barcode && ' (SKU)'}</small></span>
                  <label className={`lp-row-price${price ? ' on' : ''}`} title={price ? 'Price is printed: untick to leave it off' : 'No price: tick to print it'}>
                    <input type="checkbox" checked={price} onChange={(e) => setRows((rs) => rs.map((r) => (r.p._id === p._id ? { ...r, price: e.target.checked } : r)))} aria-label={`Print the price on ${productLabel(p)} labels`} />
                    Price
                  </label>
                  <div className="stepper">
                    <button type="button" onClick={() => setCopies(p._id, copies - 1)} aria-label="One fewer"><Minus size={14} /></button>
                    <input type="number" min="0" max="999" value={copies} onChange={(e) => setCopies(p._id, e.target.value)} aria-label={`Labels for ${productLabel(p)}`} />
                    <button type="button" onClick={() => setCopies(p._id, copies + 1)} aria-label="One more"><Plus size={14} /></button>
                  </div>
                  <button type="button" className="ghost lp-remove" onClick={() => setRows((rs) => rs.filter((r) => r.p._id !== p._id))} aria-label={`Remove ${productLabel(p)}`}><X size={15} /></button>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <div className="lp-bulk">
              <button type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, copies: Math.max(0, Math.min(999, Math.floor(r.p.stock) || 0)) })))}>One per item in stock</button>
              <button type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, copies: 1 })))}>One each</button>
            </div>
          )}

          <Field label="Label size">
            <select value={sizeId} onChange={(e) => { setSizeId(e.target.value); setSkip(0); remember({ sizeId: e.target.value }); }}>
              {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {isSheet(size) && (
            <Field label="Start at label" hint="To use a sheet that already has some labels peeled off">
              <input type="number" min="1" max={size.cols * size.rows} value={skip + 1} onChange={(e) => setSkip(Math.max(0, Math.min(size.cols * size.rows - 1, (Number(e.target.value) || 1) - 1)))} />
            </Field>
          )}
          <div className="lp-checks">
            <label className="check"><input type="checkbox" checked={rows.length ? rows.every((r) => r.price) : showPrice}
              ref={(el) => { if (el) el.indeterminate = rows.some((r) => r.price) && !rows.every((r) => r.price); }}
              onChange={(e) => { const v = e.target.checked; setShowPrice(v); setRows((rs) => rs.map((r) => ({ ...r, price: v }))); remember({ showPrice: v }); }} /> Price on all labels</label>
            <label className="check"><input type="checkbox" checked={showShop} onChange={(e) => { setShowShop(e.target.checked); remember({ showShop: e.target.checked }); }} /> Shop name</label>
          </div>
          {rows.some((r) => r.price) && anyPacked && (
            <div className="seg lp-price" role="group" aria-label="Price on the label">
              <button type="button" className={priceMode === 'piece' ? 'on' : ''} onClick={() => { setPriceMode('piece'); remember({ priceMode: 'piece' }); }}>Piece price</button>
              <button type="button" className={priceMode === 'pack' ? 'on' : ''} onClick={() => { setPriceMode('pack'); remember({ priceMode: 'pack' }); }}>Carton/box price</button>
            </div>
          )}
        </div>

        <div className="lp-right">
          <div className="lp-preview-head"><strong>Preview</strong><span>{total} label{total === 1 ? '' : 's'}{isSheet(size) && pages.length ? ` · ${pages.length} sheet${pages.length === 1 ? '' : 's'}` : ''}</span></div>
          <div className="lp-preview">
            {total === 0 ? <p className="lp-empty">The labels will show here.</p>
              : isSheet(size) ? <div className="lp-sheet-frame"><iframe title="Label preview" srcDoc={preview} /></div>
                : <iframe title="Label preview" srcDoc={preview} className="roll" />}
          </div>
          {tooLong.length > 0 && (
            <p className="lp-warn">{tooLong.map((r) => productLabel(r.p)).join(', ')}: the code is long for this label size and may not scan. Choose a bigger label or give the product a shorter SKU or barcode.</p>
          )}
          <p className="hint">Products without a barcode get one made from their SKU. Scanning it at the till adds the product.</p>
        </div>
      </div>
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={print} disabled={!total}><Printer size={16} /> Print {total || ''} label{total === 1 ? '' : 's'}</button>
      </div>
    </Modal>
  );
}
