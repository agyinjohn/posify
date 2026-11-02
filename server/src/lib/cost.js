import { r2 } from './money.js';

// Running-average cost after receiving `qty` more units at `unitCost`.
// With no stock on hand the new delivery's cost simply becomes the cost.
export const weightedCost = (stock, cost, qty, unitCost) =>
  stock > 0 ? r2((stock * cost + qty * unitCost) / (stock + qty)) : r2(unitCost);

/**
 * Receive stock and update the average cost without racing other stock changes.
 * Compare-and-set: the write lands only if stock AND cost are still what the average was based on.
 * If a sale (or another delivery) slipped in, re-read and recompute.
 *
 * read(): Promise<{stock, costPrice}|null>
 * cas(prev, next): Promise<doc|null>   next = { stock, costPrice }; null if prev no longer matches
 * unitCost: number | undefined (undefined = keep the product's current cost)
 * Returns { doc, unitCost } or null if it never settled / product gone.
 */
export async function applyReceipt({ read, cas, qty, unitCost, retries = 5 }) {
  for (let i = 0; i < retries; i += 1) {
    const prev = await read();
    if (!prev) return null;
    const cost = unitCost === undefined ? prev.costPrice : unitCost;
    const next = {
      stock: Math.round((prev.stock + qty) * 1000) / 1000,
      costPrice: weightedCost(prev.stock, prev.costPrice, qty, cost),
    };
    const doc = await cas(prev, next);
    if (doc) return { doc, unitCost: cost };
  }
  return null;
}
