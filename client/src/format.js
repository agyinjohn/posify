const money = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' });
export const fmt = (n) => money.format(Number(n) || 0);
export const qtyFmt = (n) => (Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(3).replace(/0+$/, ''));
export const dateTime = (d) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const METHODS = ['Cash', 'MoMo', 'Card', 'Transfer'];
// The signed-in shop's name (from the server) on receipts and in the sidebar. A live binding: importers see the
// new value once auth.jsx sets it after sign-in.
const DEFAULT_SHOP_NAME = import.meta.env.VITE_SHOP_NAME || 'Posify';
export let SHOP_NAME = DEFAULT_SHOP_NAME;
export const setShopName = (name) => { SHOP_NAME = name || DEFAULT_SHOP_NAME; };

// Unique id for idempotency keys. crypto.randomUUID only exists on HTTPS/localhost, and shops often
// run the till over plain http on the local network, so fall back to getRandomValues.
export const newId = () => {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  const bytes = new Uint8Array(16);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256); }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

// A product's name with its optional size, e.g. "Super Star (Small)". Mirrors server/src/lib/productLabel.js.
export const productLabel = (p) => {
  const size = typeof p?.size === 'string' ? p.size.trim() : '';
  return size ? `${p.name} (${size})` : (p?.name ?? '');
};
// Sizes offered when adding a product; the shop's own sizes are added to the list as they are used.
export const COMMON_SIZES = ['Small', 'Medium', 'Large', 'Extra large', 'Mini', 'Family size', '250ml', '330ml', '350ml', '500ml', '750ml', '1L', '1.5L', '2L', '5L', '100g', '200g', '250g', '400g', '500g', '1kg', '2kg', '5kg', '25kg', '50kg'];
