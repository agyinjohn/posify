// Product labels: sizes, layout on sheets or rolls, and the HTML that is printed. Pure, so it is unit tested
// (client/test/labels.test.js). Sizes are in millimetres.
import { barcodeModules, barcodeSvg } from './barcode.js';

export const LABEL_SIZES = [
  { id: 'a4-3x8', name: 'A4 sheet, 24 per page (70 × 37 mm)', cols: 3, rows: 8, w: 70, h: 37 },
  { id: 'a4-3x7', name: 'A4 sheet, 21 per page (70 × 42 mm)', cols: 3, rows: 7, w: 70, h: 42.3 },
  { id: 'a4-4x10', name: 'A4 sheet, 40 per page (48.5 × 25.4 mm)', cols: 4, rows: 10, w: 48.5, h: 25.4 },
  { id: 'a4-5x13', name: 'A4 sheet, 65 per page (38 × 21 mm)', cols: 5, rows: 13, w: 38.1, h: 21.2 },
  { id: 'roll-50x25', name: 'Label printer roll, 50 × 25 mm', w: 50, h: 25 },
  { id: 'roll-40x30', name: 'Label printer roll, 40 × 30 mm', w: 40, h: 30 },
  { id: 'roll-58x40', name: 'Label printer roll, 58 × 40 mm', w: 58, h: 40 },
  { id: 'roll-38x25', name: 'Label printer roll, 38 × 25 mm', w: 38, h: 25 },
];
export const sizeById = (id) => LABEL_SIZES.find((s) => s.id === id) || LABEL_SIZES[0];
export const isSheet = (size) => Boolean(size.cols);
const A4 = { w: 210, h: 297 };

// What a product's label scans as: its barcode, or its SKU (the till finds products by SKU too).
export const labelCode = (p) => (p.barcode && String(p.barcode).trim()) || p.sku;

/**
 * items: [{ product, copies }]. skip: empty cells to leave at the start of the first sheet (a part-used sheet).
 * Returns pages: each an array of cells, a cell being a product or null (left empty). Rolls get one label per page.
 */
export function layoutLabels(items, size, { skip = 0 } = {}) {
  const labels = items.flatMap(({ product, copies }) => Array.from({ length: Math.max(0, Math.floor(Number(copies) || 0)) }, () => product));
  if (!isSheet(size)) return labels.map((p) => [p]);
  const per = size.cols * size.rows;
  const cells = [...Array(Math.min(Math.max(0, Math.floor(Number(skip) || 0)), per - 1)).fill(null), ...labels];
  const pages = [];
  for (let i = 0; i < cells.length; i += per) pages.push(cells.slice(i, i + per));
  return labels.length ? pages : [];
}

// A barcode needs bars at least ~0.2 mm wide to scan reliably on common printers.
export function barcodeFits(code, size) {
  const mm = size.w - 4;
  return mm / barcodeModules(code) >= 0.19;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One label's inner HTML. opts: { shopName, showPrice, showShop, priceOf(p) -> text, nameOf(p) -> text }
export function labelInner(p, size, { shopName = '', showPrice = true, showShop = true, priceOf, nameOf }) {
  const code = labelCode(p);
  const small = size.h < 28;
  const barH = Math.max(7, size.h * (small ? 0.36 : 0.4));
  let bars = '';
  try { bars = barcodeSvg(code, { width: size.w - 4, height: barH }); } catch { bars = '<div class="lb-bad">No barcode</div>'; }
  return `${showShop && shopName && !small ? `<div class="lb-shop">${esc(shopName)}</div>` : ''}`
    + `<div class="lb-name">${esc(nameOf(p))}</div>`
    + `${showPrice ? `<div class="lb-price">${esc(priceOf(p))}</div>` : ''}`
    + `<div class="lb-bars">${bars}</div><div class="lb-code">${esc(code)}</div>`;
}

// The whole printable document.
export function labelsDocument(pages, size, opts, { autoPrint = true } = {}) {
  const sheet = isSheet(size);
  const left = sheet ? (A4.w - size.cols * size.w) / 2 : 0;
  const top = sheet ? (A4.h - size.rows * size.h) / 2 : 0;
  const f = Math.min(size.h / 25, size.w / 40); // font scale
  const css = `
    @page { size: ${sheet ? 'A4' : `${size.w}mm ${size.h}mm`}; margin: 0; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { position: relative; width: ${sheet ? A4.w : size.w}mm; height: ${sheet ? A4.h : size.h}mm; page-break-after: always; break-after: page; overflow: hidden; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    .lb { position: absolute; width: ${size.w}mm; height: ${size.h}mm; padding: 1.2mm 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
    .lb-shop { font-size: ${(6.5 * f).toFixed(1)}pt; text-transform: uppercase; letter-spacing: .04em; color: #333; white-space: nowrap; overflow: hidden; max-width: 100%; }
    .lb-name { font-size: ${(8.5 * f).toFixed(1)}pt; font-weight: bold; line-height: 1.1; max-height: 2.3em; overflow: hidden; max-width: 100%; }
    .lb-price { font-size: ${(11 * f).toFixed(1)}pt; font-weight: bold; margin: .3mm 0; }
    .lb-bars { line-height: 0; margin-top: .4mm; } .lb-bars svg { display: block; }
    .lb-code { font-size: ${(6.5 * f).toFixed(1)}pt; letter-spacing: .08em; margin-top: .3mm; }
    .lb-bad { font-size: 7pt; color: #900; }
    @media screen { body { background: #e9ecef; padding: 8mm; } .page { background: #fff; margin: 0 auto 8mm; box-shadow: 0 2px 10px rgba(0,0,0,.15); } ${sheet ? '.lb { outline: 0.2mm dashed #ccc; }' : ''} }`;
  const body = pages.map((cells) => `<div class="page">${cells.map((p, i) => {
    if (!p) return '';
    const x = sheet ? left + (i % size.cols) * size.w : 0;
    const y = sheet ? top + Math.floor(i / size.cols) * size.h : 0;
    return `<div class="lb" style="left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm">${labelInner(p, size, opts)}</div>`;
  }).join('')}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>${css}</style></head><body>${body}${autoPrint ? '<script>window.onload=()=>setTimeout(()=>window.print(),250);</script>' : ''}</body></html>`;
}
