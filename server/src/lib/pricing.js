import { r2, r3, PAYMENT_METHODS } from './money.js';
import { pieceUnitPrice, packSpecificPrice, packPriceFor } from './unitPrices.js';

export class SaleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Pure pricing logic (no DB) so it can be unit tested.
 * lines: [{ productId, qty, discount }]   productsById: Map<string, product-like>
 */
export function priceSale({ lines, productsById, mode, orderDiscount = 0 }) {
  if (!['retail', 'wholesale'].includes(mode)) throw new SaleError('Invalid sale mode');
  if (!Array.isArray(lines) || lines.length === 0) throw new SaleError('Cart is empty');
  if (lines.length > 200) throw new SaleError('Too many lines in one sale');

  // Merge duplicate products so stock is decremented once per product.
  // A line may carry unit:'pack' to sell by the pack (carton/box/etc.);
  // qty is then the number of packs and is expanded to pieces here.
  const merged = new Map();
  for (const l of lines) {
    const rawQty = Number(l?.qty);
    if (!Number.isFinite(rawQty) || rawQty <= 0 || rawQty > 1_000_000) throw new SaleError('Quantity must be greater than zero');
    const key = String(l.productId);
    const p = productsById.get(key);
    const unitsPerPack = (p && p.unitsPerPack > 1) ? p.unitsPerPack : 1;
    const isPack = l.unit === 'pack' && unitsPerPack > 1;
    const qty = isPack ? r3(rawQty * unitsPerPack) : r3(rawQty);
    const disc = Math.max(0, Number(l.discount) || 0);
    // Price this line now: packs use the pack price when the product has one, pieces use the piece price.
    // (Packs and loose pieces of one product can therefore carry different prices on the same sale.)
    let lineGross = 0;
    if (p) {
      const piecePrice = pieceUnitPrice(p, mode);
      const packPrice = isPack ? packSpecificPrice(p, mode) : null;
      lineGross = packPrice !== null ? r2(packPrice * rawQty) : r2(piecePrice * qty);
    }
    const prev = merged.get(key) || { qty: 0, discount: 0, packQty: 0, loosePcs: 0, isPack: false, gross: 0 };
    merged.set(key, {
      gross: r2(prev.gross + lineGross),
      qty: r3(prev.qty + qty),
      discount: r2(prev.discount + disc),
      // Receipt breakdown: packs and loose pieces of the same product are kept apart,
      // so "2 ctn + 3 pcs" never shows as a misleading single pack count.
      packQty: isPack ? r3((prev.packQty || 0) + rawQty) : prev.packQty,
      loosePcs: isPack ? prev.loosePcs : r3((prev.loosePcs || 0) + qty),
      isPack: prev.isPack || isPack,
    });
  }

  let grossTotal = 0;
  let lineDiscountTotal = 0;
  let subtotal = 0;
  const items = [];

  for (const [key, line] of merged) {
    const p = productsById.get(key);
    if (!p || p.active === false) throw new SaleError('A product in the cart is no longer available', 404);
    const unitPrice = pieceUnitPrice(p, mode);
    const gross = line.gross;
    const discount = r2(Math.min(line.discount, gross));
    const lineTotal = r2(gross - discount);
    grossTotal += gross;
    lineDiscountTotal += discount;
    subtotal += lineTotal;
    items.push({
      product: p._id,
      name: p.name,
      sku: p.sku,
      qty: line.qty,           // always in pieces
      packQty: line.isPack ? line.packQty : null,
      loosePcs: line.isPack && line.loosePcs > 0 ? line.loosePcs : null, // pieces sold alongside the packs
      packLabel: line.isPack ? (p.packLabel || 'pack') : null,
      unitsPerPack: line.isPack ? p.unitsPerPack : null,
      unitPrice,                                              // per piece (applies to loose pieces)
      packPrice: line.isPack ? packPriceFor(p, mode) : null,  // per pack, as charged
      costPrice: p.costPrice,
      discount,
      lineTotal,
    });
  }

  subtotal = r2(subtotal);
  const od = r2(Math.min(Math.max(0, Number(orderDiscount) || 0), subtotal));
  const total = r2(subtotal - od);
  if (total <= 0) throw new SaleError('Sale total must be greater than zero');

  return {
    items,
    grossTotal: r2(grossTotal),
    subtotal,
    orderDiscount: od,
    discountTotal: r2(lineDiscountTotal + od),
    total,
  };
}

/**
 * Cashier picks how the customer paid. Overpayment is treated as change and
 * must be covered by cash; it is removed from the cash line so per-method
 * totals match what actually stayed in the till.
 */
export function settlePayments(payments, total) {
  const list = (Array.isArray(payments) ? payments : []).map((p) => {
    const amount = r2(p?.amount);
    if (!PAYMENT_METHODS.includes(p?.method)) throw new SaleError('Choose a valid payment method');
    if (!Number.isFinite(amount) || amount <= 0) throw new SaleError('Payment amount must be greater than zero');
    return { method: p.method, amount };
  });

  const paid = r2(list.reduce((s, p) => s + p.amount, 0));
  let change = 0;

  if (paid > total) {
    change = r2(paid - total);
    const cashTotal = r2(list.filter((p) => p.method === 'Cash').reduce((s, p) => s + p.amount, 0));
    if (cashTotal < change) throw new SaleError('Only cash payments can be over the total (to give change)');
    let remaining = change;
    for (const p of list) {
      if (p.method !== 'Cash' || remaining <= 0) continue;
      const take = Math.min(p.amount, remaining);
      p.amount = r2(p.amount - take);
      remaining = r2(remaining - take);
    }
  }

  const kept = list.filter((p) => p.amount > 0);
  const amountPaid = r2(kept.reduce((s, p) => s + p.amount, 0));
  return { payments: kept, amountPaid, change, balance: r2(total - amountPaid) };
}
