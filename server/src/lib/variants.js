import { SaleError } from './pricing.js';
import { productLabel } from './productLabel.js';

/**
 * Sizes and colours. Each size/colour combination is its own product (own SKU, barcode, stock and price), sharing the
 * name, so stock, sales, returns and reports work exactly as for any product. These helpers are pure (unit tested).
 */

export const MAX_VARIANTS = 100;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const slug = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const comboKey = (name, size, color) => [name, size, color].map((v) => String(v || '').trim().toLowerCase()).join('|');

/**
 * base: the shared fields (name, category, prices, pack, sku prefix). combos: [{ size, color, sku?, barcode?, stock? }].
 * takenSkus / takenBarcodes: Sets already used in the shop. existing: Set of comboKey(name, size, color) already there.
 * Returns the product records to create; throws SaleError naming the first problem.
 */
export function planVariants({ base, combos, takenSkus = new Set(), takenBarcodes = new Set(), existing = new Set() }) {
  const name = text(base?.name, 120);
  if (!name) throw new SaleError('Enter the product name');
  if (!Array.isArray(combos) || combos.length === 0) throw new SaleError('Add at least one size or colour');
  if (combos.length > MAX_VARIANTS) throw new SaleError(`Up to ${MAX_VARIANTS} sizes and colours at a time`);

  const prefix = slug(text(base.sku, 40) || name).slice(0, 24) || 'ITEM';
  const skus = new Set(); const barcodes = new Set(); const seen = new Set();
  return combos.map((c, i) => {
    const size = text(c?.size, 30); const color = text(c?.color, 30);
    const label = productLabel({ name, size, color });
    if (!size && !color) throw new SaleError(`Line ${i + 1}: give a size or a colour`);
    const key = comboKey(name, size, color);
    if (seen.has(key)) throw new SaleError(`${label} is listed twice`);
    if (existing.has(key)) throw new SaleError(`${label} already exists`);
    seen.add(key);

    let sku = text(c.sku, 60);
    if (sku) {
      if (skus.has(sku) || takenSkus.has(sku)) throw new SaleError(`SKU ${sku} is already in use`);
    } else {
      const stem = [prefix, slug(size), slug(color)].filter(Boolean).join('-').slice(0, 56);
      sku = stem; let n = 1;
      while (skus.has(sku) || takenSkus.has(sku)) { n += 1; sku = `${stem}-${n}`; }
    }
    skus.add(sku);

    const barcode = text(c.barcode, 60) || undefined;
    if (barcode && (barcodes.has(barcode) || takenBarcodes.has(barcode))) throw new SaleError(`Barcode ${barcode} is already in use`);
    if (barcode) barcodes.add(barcode);

    const stock = c.stock === '' || c.stock == null ? 0 : Number(c.stock);
    if (!Number.isFinite(stock) || stock < 0 || stock > 1e6) throw new SaleError(`${label}: opening stock must be 0 or more`);
    return { ...base, name, size, color, sku, barcode, stock };
  });
}
