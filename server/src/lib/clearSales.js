import mongoose from 'mongoose';
import Sale from '../models/Sale.js';
import Refund from '../models/Refund.js';
import CreditNote from '../models/CreditNote.js';
import CustomerPayment from '../models/CustomerPayment.js';
import HeldSale from '../models/HeldSale.js';
import Shift from '../models/Shift.js';
import StockMovement from '../models/StockMovement.js';
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';
import Counter, { receiptCounterId } from '../models/Counter.js';
import { runAsShop } from './tenant.js';
import { r3 } from './money.js';

/**
 * Wipes a shop's sales activity (for shops that tested the till before going live), keeping its set-up:
 * products, customers, suppliers, users and purchase orders stay. Removed: sales, refunds, credit notes,
 * debt payments, held sales and shifts; customers' balances go back to 0 and receipts restart at R-000001.
 * With restoreStock, the pieces those sales took out of stock are put back and their stock-history lines removed,
 * so stock reads as if the sales never happened; without it, stock stays as it is now.
 */

export const SALE_MOVES = ['sale', 'void', 'return'];

// Pieces to put back per product: the opposite of every sale / void / return movement (pure, unit tested).
export function planStockRestore(moves) {
  const map = new Map();
  for (const m of moves) {
    if (!SALE_MOVES.includes(m.type)) continue;
    const id = String(m.product);
    map.set(id, (map.get(id) || 0) - m.qty);
  }
  return [...map].map(([product, qty]) => ({ product, qty: r3(qty) })).filter((r) => r.qty !== 0);
}

// What would be removed, without removing anything.
export function salesDataSummary(shop) {
  return runAsShop(shop, async () => {
    const [sales, refunds, creditNotes, payments, held, shifts, moves, owing, first, last] = await Promise.all([
      Sale.countDocuments({}), Refund.countDocuments({}), CreditNote.countDocuments({}), CustomerPayment.countDocuments({}),
      HeldSale.countDocuments({}), Shift.countDocuments({}), StockMovement.countDocuments({ type: { $in: SALE_MOVES } }),
      Customer.countDocuments({ balance: { $ne: 0 } }),
      Sale.findOne({}).sort({ createdAt: 1 }).select('createdAt').lean(),
      Sale.findOne({}).sort({ createdAt: -1 }).select('createdAt').lean(),
    ]);
    return { sales, refunds, creditNotes, debtPayments: payments, heldSales: held, shifts, stockMoves: moves, customersOwing: owing,
      firstSale: first?.createdAt ?? null, lastSale: last?.createdAt ?? null };
  });
}

async function wipe(shop, { restoreStock }, session) {
  const o = session ? { session } : {};
  let restored = [];
  if (restoreStock) {
    const moves = await StockMovement.find({ type: { $in: SALE_MOVES } }).select('product type qty').session(session ?? null).lean();
    restored = planStockRestore(moves);
    if (restored.length) {
      await Product.bulkWrite(restored.map((r) => ({ updateOne: { filter: { _id: r.product }, update: { $inc: { stock: r.qty } } } })), o);
    }
    await StockMovement.deleteMany({ type: { $in: SALE_MOVES } }, o);
  }
  const del = async (Model) => (await Model.deleteMany({}, o)).deletedCount;
  const counts = {
    sales: await del(Sale), refunds: await del(Refund), creditNotes: await del(CreditNote), debtPayments: await del(CustomerPayment),
    heldSales: await del(HeldSale), shifts: await del(Shift),
  };
  counts.customersReset = (await Customer.updateMany({ balance: { $ne: 0 } }, { $set: { balance: 0 } }, o)).modifiedCount;
  // The counter's id names the shop, so it is safe to address directly (older counters may lack the shop field).
  await Counter.deleteOne({ _id: receiptCounterId(shop) }, { ...o, skipTenant: true });
  return { ...counts, productsRestocked: restored.length, piecesRestocked: r3(restored.reduce((t, r) => t + r.qty, 0)) };
}

// All or nothing where the database supports transactions (Atlas does); otherwise one step after another.
export function clearShopSales(shop, { restoreStock = true } = {}) {
  return runAsShop(shop, async () => {
    let session;
    try {
      session = await mongoose.startSession();
      let result;
      await session.withTransaction(async () => { result = await wipe(shop, { restoreStock }, session); });
      return result;
    } catch (err) {
      const noTx = err?.code === 20 || /replica set|Transaction numbers/i.test(err?.message || '');
      if (!noTx) throw err;
      return wipe(shop, { restoreStock }, null);
    } finally {
      await session?.endSession();
    }
  });
}
