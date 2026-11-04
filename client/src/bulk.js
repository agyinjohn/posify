// Bulk (pack/carton) <-> piece conversions. Everything is stored and sold per piece; the owner can
// type costs, prices and quantities per pack and these helpers do the maths. Pure, so it is unit tested.

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
// Per-piece prices keep 6 decimals so that "120 per carton of 7" still totals exactly 120.00 when a full carton is sold.
export const r6 = (n) => Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;

export const unitsOf = (p) => Math.max(1, Math.floor(Number(p?.unitsPerPack) || 1));
export const hasPack = (p) => unitsOf(p) > 1;
export const packName = (p) => (p?.packLabel || '').trim() || 'pack';

// A value typed per pack -> stored per piece (prices), and back for display.
export const toPiecePrice = (perPack, units) => (units > 1 ? r6(Number(perPack) / units) : r6(perPack));
export const toPackPrice = (perPiece, units) => r2(Number(perPiece) * Math.max(1, units));

// A quantity typed in packs -> pieces, and back.
export const toPieces = (packs, units) => r3(Number(packs) * Math.max(1, units));
export const toPacks = (pieces, units) => r3(Number(pieces) / Math.max(1, units));

// "2 ctn + 3 pcs" style breakdown of a piece count.
export function breakdown(pieces, p) {
  const u = unitsOf(p);
  if (u <= 1) return `${r3(pieces)}`;
  const whole = Math.floor(pieces / u);
  const rest = r3(pieces - whole * u);
  const parts = [];
  if (whole) parts.push(`${whole} ${packName(p)}`);
  if (rest || !whole) parts.push(`${rest} pcs`);
  return parts.join(' + ');
}

// ── Which price applies: per piece, or per pack (carton/box) ──────────────────────────────────────
// Mirrors server/src/lib/unitPrices.js (same test vectors in both). A product always has a piece price and may
// have its own pack price (a carton of 12 at 120 while pieces are 12 each). No pack price = pieces x piece price.
export const pieceUnitPrice = (p, mode) => (mode === 'wholesale' && p.wholesalePrice > 0 ? p.wholesalePrice : p.retailPrice);

export function packSpecificPrice(p, mode) {
  if (unitsOf(p) <= 1) return null;
  if (mode === 'wholesale') {
    if (p.packWholesalePrice > 0) return p.packWholesalePrice;
    if (p.wholesalePrice > 0) return null; // a wholesale piece price exists: pieces x that
  }
  return p.packRetailPrice > 0 ? p.packRetailPrice : null;
}

export const packPriceFor = (p, mode) => packSpecificPrice(p, mode) ?? r2(pieceUnitPrice(p, mode) * unitsOf(p));

// Money for `qty` of the product in the given unit ('pack' counts packs, anything else counts pieces).
export function lineGross(p, mode, unit, qty) {
  const units = unitsOf(p);
  if (unit === 'pack' && units > 1) {
    const specific = packSpecificPrice(p, mode);
    return specific !== null ? r2(specific * qty) : r2(pieceUnitPrice(p, mode) * qty * units);
  }
  return r2(pieceUnitPrice(p, mode) * qty);
}
