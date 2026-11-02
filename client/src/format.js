const money = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' });
export const fmt = (n) => money.format(Number(n) || 0);
export const qtyFmt = (n) => (Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(3).replace(/0+$/, ''));
export const dateTime = (d) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const METHODS = ['Cash', 'MoMo', 'Card', 'Transfer'];
export const SHOP_NAME = import.meta.env.VITE_SHOP_NAME || 'Posify';

// Unique id for idempotency keys. crypto.randomUUID only exists on HTTPS/localhost, and shops often
// run the till over plain http on the local network, so fall back to getRandomValues.
export const newId = () => {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  const bytes = new Uint8Array(16);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256); }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};
