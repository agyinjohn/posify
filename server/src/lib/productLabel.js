// A product's name with its size, e.g. "Super Star (Small)". The size is an optional label only: each size is its own
// product with its own price and stock. Kept in step with client/src/format.js productLabel.
export const productLabel = (p) => {
  const size = typeof p?.size === 'string' ? p.size.trim() : '';
  return size ? `${p.name} (${size})` : (p?.name ?? '');
};
