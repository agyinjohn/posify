/**
 * The price depends on HOW the customer buys, not on a retail/wholesale switch:
 *   - single pieces  -> the piece price (retail)      = product.retailPrice
 *   - a full pack    -> the pack price (wholesale)    = product.packRetailPrice (the product's one carton/box price)
 * With no pack price, a pack is pieces x the piece price.
 *
 * Products saved before this rule may still carry the old wholesale fields. They keep selling as before until the
 * product is next saved (the form then stores a single pack price and clears them): an old wholesale pack price, or
 * else an old wholesale piece price x pieces, is used as the pack price. Kept in step with client/src/bulk.js.
 */
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const unitsOf = (p) => (p && p.unitsPerPack > 1 ? p.unitsPerPack : 1);

export const pieceUnitPrice = (p) => p.retailPrice;

// The price set for a whole pack, or null when a pack is simply pieces x the piece price.
export function packSpecificPrice(p) {
  const units = unitsOf(p);
  if (units <= 1) return null;
  if (p.packWholesalePrice > 0) return p.packWholesalePrice; // older products: their wholesale carton price
  if (p.packRetailPrice > 0) return p.packRetailPrice;       // the pack price
  if (p.wholesalePrice > 0) return r2(p.wholesalePrice * units); // older products: wholesale per piece, by the pack
  return null;
}

// Price of one whole pack, whether set or worked out from the piece price.
export const packPriceFor = (p) => packSpecificPrice(p) ?? r2(pieceUnitPrice(p) * unitsOf(p));
