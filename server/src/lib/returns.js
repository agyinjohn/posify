import { r2, r3 } from './money.js';
import { SaleError } from './pricing.js';

/**
 * Pure logic for returns and voids (no DB) so it can be unit tested.
 *
 * A void is simply a return of everything still outstanding, so both go through planReturn.
 * Money is split in two: the part that offsets what the customer still owes on the sale
 * (credit reduction), and the rest, which is handed back to the customer (cash refund).
 */

// Order-level discount shared across lines: what the customer really paid per rupee of line value.
export const orderFactor = (sale) => (sale.subtotal > 0 ? sale.total / sale.subtotal : 1);

// Value (after discounts) of everything returned so far, derived from the line items.
export function returnedValueOf(sale) {
  const items = sale.items || [];
  if (items.length > 0 && items.every((i) => r3(i.returnedQty || 0) >= i.qty)) return r2(sale.total);
  const f = orderFactor(sale);
  return r2(items.reduce((s, i) => s + (i.qty > 0 ? r2((i.lineTotal * (i.returnedQty || 0) * f) / i.qty) : 0), 0));
}

// Net (after returns) figures used by reports and shift cash-up.
export function netSale(sale) {
  const returned = returnedValueOf(sale);
  const net = r2(sale.total - returned);
  const share = sale.total > 0 ? net / sale.total : 0;
  const profit = (sale.items || []).reduce((s, i) => {
    const rem = r3(i.qty - (i.returnedQty || 0));
    const frac = i.qty > 0 ? rem / i.qty : 0;
    return s + i.lineTotal * frac - (i.costPrice || 0) * rem;
  }, 0) - (sale.orderDiscount || 0) * share;
  return { net, profit: r2(profit), credit: r2(Math.max(0, (sale.balance || 0) - (sale.creditReturned || 0))) };
}

/**
 * lines: [{ productId, qty }]. Pass { all: true } to return everything still outstanding (void).
 * customerBalance: what the customer currently owes (credit can only offset up to this).
 */
export function planReturn(sale, { lines, all = false, customerBalance = Infinity }) {
  const picks = new Map(); // item index -> qty
  if (all) {
    sale.items.forEach((it, index) => {
      const rem = r3(it.qty - (it.returnedQty || 0));
      if (rem > 0) picks.set(index, rem);
    });
  } else {
    if (!Array.isArray(lines) || lines.length === 0) throw new SaleError('No lines provided');
    for (const l of lines) {
      const index = sale.items.findIndex((i) => String(i.product) === String(l.productId));
      if (index < 0) throw new SaleError('Product not found in this sale');
      const qty = r3(l.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new SaleError('Return quantity must be greater than zero');
      picks.set(index, r3((picks.get(index) || 0) + qty));
    }
  }
  if (picks.size === 0) throw new SaleError('Nothing left to return on this sale', 409);

  const before = returnedValueOf(sale);
  const updates = [];
  for (const [index, qty] of picks) {
    const item = sale.items[index];
    const already = r3(item.returnedQty || 0);
    if (r3(already + qty) > item.qty) {
      throw new SaleError(`Cannot return more than sold for ${item.name} (sold ${item.qty}, already returned ${already})`);
    }
    updates.push({ index, productId: item.product, name: item.name, qty, costPrice: item.costPrice, returnedQty: r3(already + qty) });
  }

  const after = returnedValueOf({
    ...sale,
    items: sale.items.map((it, i) => (picks.has(i) ? { ...it, returnedQty: r3((it.returnedQty || 0) + picks.get(i)) } : it)),
  });
  const value = r2(after - before);
  const fullyReturned = sale.items.every((it, i) => r3((it.returnedQty || 0) + (picks.get(i) || 0)) >= it.qty);

  const outstanding = sale.customer ? r2(Math.max(0, (sale.balance || 0) - (sale.creditReturned || 0))) : 0;
  const creditReduction = r2(Math.min(value, outstanding, Math.max(0, customerBalance)));
  const cashRefund = r2(value - creditReduction);

  return { updates, value, creditReduction, cashRefund, fullyReturned };
}
