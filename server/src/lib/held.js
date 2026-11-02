import { SaleError } from './pricing.js';
import { r2, r3 } from './money.js';

/**
 * Clean the cart snapshot stored with a held sale. The unit ('piece' or 'pack') is kept, so a line
 * held as 2 cartons resumes as 2 cartons rather than 2 pieces.
 */
export function cleanHeldItems(items, isValidId) {
  if (!Array.isArray(items) || items.length === 0) throw new SaleError('Cart is empty');
  if (items.length > 200) throw new SaleError('Too many lines to hold');
  return items.map((i) => {
    if (!isValidId(i?.productId)) throw new SaleError('Invalid product');
    const qty = r3(Number(i.qty));
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) throw new SaleError('Quantity must be greater than zero');
    return {
      productId: i.productId,
      qty,
      unit: i.unit === 'pack' ? 'pack' : 'piece',
      discount: Math.max(0, r2(Number(i.discount) || 0)),
    };
  });
}
