// A product's name with its size and colour, e.g. "Super Star (Small)" or "Kente Dress (M, Red)". Size and colour are
// labels only: each one is its own product with its own price and stock. Kept in step with client/src/format.js.
export const productLabel = (p) => {
  const t = (v) => (typeof v === 'string' ? v.trim() : '');
  const extra = [t(p?.size), t(p?.color)].filter(Boolean).join(', ');
  return extra ? `${p.name} (${extra})` : (p?.name ?? '');
};
