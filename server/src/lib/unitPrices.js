/**
 * Which price applies when a product is sold by the piece or by the pack (carton/box).
 *
 * Every product has a price per piece. It may also have its OWN price per pack (e.g. a carton of 12 sells for
 * 120 while single pieces are 12 each, so cartons are cheaper than 12 singles). When no pack price is set the
 * pack is simply pieces x the piece price. Wholesale falls back to retail, as before. Kept in step with
 * client/src/bulk.js (same test vectors in both).
 */
export const unitsOf = (p) => (p && p.unitsPerPack > 1 ? p.unitsPerPack : 1);

export const pieceUnitPrice = (p, mode) => (mode === 'wholesale' && p.wholesalePrice > 0 ? p.wholesalePrice : p.retailPrice);

// The pack-specific price for this sale mode, or null when the pack should just be pieces x piece price.
export function packSpecificPrice(p, mode) {
  if (unitsOf(p) <= 1) return null;
  if (mode === 'wholesale') {
    if (p.packWholesalePrice > 0) return p.packWholesalePrice;
    if (p.wholesalePrice > 0) return null; // a wholesale piece price exists: pieces x that
  }
  return p.packRetailPrice > 0 ? p.packRetailPrice : null;
}

// Price of one whole pack, whether set explicitly or worked out from the piece price.
export const packPriceFor = (p, mode) =>
  packSpecificPrice(p, mode) ?? Math.round(pieceUnitPrice(p, mode) * unitsOf(p) * 100) / 100;
