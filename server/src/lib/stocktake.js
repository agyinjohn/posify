/**
 * Set a product's stock to a physical count without losing sales made while the count is saved.
 * Compare-and-set: the write only lands if stock still equals what we based the variance on.
 * If a sale slipped in, re-read and recompute (a few times) instead of overwriting it.
 *
 * read(): Promise<number|null>            current stock, null if the product is gone
 * cas(expected, counted): Promise<boolean> true if stock was `expected` and is now `counted`
 * Returns { systemQty, variance } as actually applied, or null if it never settled.
 */
export async function applyCount({ read, cas, counted, retries = 4 }) {
  for (let i = 0; i < retries; i += 1) {
    const current = await read();
    if (current === null || current === undefined) return null;
    if (current === counted) return { systemQty: current, variance: 0 };
    if (await cas(current, counted)) {
      return { systemQty: current, variance: Math.round((counted - current) * 1000) / 1000 };
    }
  }
  return null;
}
