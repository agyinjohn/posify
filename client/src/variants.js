// Sizes and colours. Each size/colour is its own product sharing the name; here they are grouped back into one
// "style" for the Products page and the till. Pure, so it is unit tested (client/test/variants.test.js).

// Clothing sizes, in the order they are worn, so pickers list them small to large.
export const CLOTHING_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const norm = (v) => String(v || '').trim().toLowerCase();
export const isVariant = (p) => Boolean((p.size || '').trim() || (p.color || '').trim());
export const styleKey = (p) => norm(p.name);

// Sizes in a sensible order: clothing sizes small to large, then numbers by value (38, 40, 42), then anything else A–Z.
const sizeRank = (s) => {
  const i = CLOTHING_SIZES.findIndex((x) => x.toLowerCase() === norm(s));
  if (i >= 0) return [0, i, ''];
  const n = parseFloat(s);
  if (!Number.isNaN(n)) return [1, n, norm(s)];
  return [2, 0, norm(s)];
};
export const compareSizes = (a, b) => {
  const x = sizeRank(a); const y = sizeRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
};
export const uniqueSorted = (values, cmp) => {
  const seen = new Map();
  for (const v of values) { const t = (v || '').trim(); if (t && !seen.has(norm(t))) seen.set(norm(t), t); }
  return [...seen.values()].sort(cmp);
};

/**
 * Turn a product list into items: a plain product stays { type: 'product', product }, and products sharing a name
 * that have a size or colour become { type: 'style', key, name, variants, sizes, colors, stock, minPrice, maxPrice, image }.
 * A style with a single variant is still a style (so its size/colour shows). Order follows the first appearance.
 */
export function groupProducts(list, priceOf = (p) => p.retailPrice) {
  const out = []; const styles = new Map();
  for (const p of list) {
    if (!isVariant(p)) { out.push({ type: 'product', key: p._id, product: p }); continue; }
    const k = styleKey(p);
    let s = styles.get(k);
    if (!s) { s = { type: 'style', key: `style:${k}`, name: p.name, variants: [] }; styles.set(k, s); out.push(s); }
    s.variants.push(p);
  }
  for (const s of styles.values()) {
    s.sizes = uniqueSorted(s.variants.map((v) => v.size), compareSizes);
    s.colors = uniqueSorted(s.variants.map((v) => v.color), (a, b) => a.localeCompare(b));
    s.stock = s.variants.reduce((t, v) => t + (v.stock > 0 ? v.stock : 0), 0);
    const prices = s.variants.map(priceOf);
    s.minPrice = Math.min(...prices); s.maxPrice = Math.max(...prices);
    s.image = s.variants.find((v) => v.image?.url)?.image ?? null;
    s.category = s.variants[0].category;
    s.variants.sort((a, b) => compareSizes(a.size, b.size) || norm(a.color).localeCompare(norm(b.color)));
  }
  return out;
}

// The variant for a size + colour choice (either may be '' when the style has no sizes / no colours).
export const findVariant = (variants, size, color) =>
  variants.find((v) => norm(v.size) === norm(size) && norm(v.color) === norm(color)) ?? null;

// Stock of a size (given the colour picked, if any) or of a colour (given the size picked), for greying out chips.
export const stockFor = (variants, { size, color }) => variants
  .filter((v) => (size == null || norm(v.size) === norm(size)) && (color == null || norm(v.color) === norm(color)))
  .reduce((t, v) => t + (v.stock > 0 ? v.stock : 0), 0);
