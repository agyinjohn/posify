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
import Expense from '../models/Expense.js';
import { runAsShop } from './tenant.js';
import { r2, r3 } from './money.js';
import { SaleError } from './pricing.js';

/**
 * Wipes a shop's sales activity (for shops that tested the till before going live), keeping its set-up:
 * products, customers, suppliers, users and purchase orders stay.
 *
 * Everything (no `before`): sales, refunds, credit notes, debt payments, held sales and shifts go; customers'
 * balances go back to 0 and receipts restart at R-000001.
 * Before a date (`before` = 'YYYY-MM-DD', shop time): only sales made before that day go, with their refunds and
 * credit notes (whenever those happened), plus debt payments and held sales from before it and shifts closed before it.
 * Each customer's balance loses exactly what the removed records added or took off. Receipt numbers carry on.
 *
 * With restoreStock, the pieces the removed sales took out of stock are put back and their stock-history lines removed,
 * so stock reads as if those sales never happened; without it, stock stays as it is now.
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

// How each customer's balance changes when these records are removed (pure, unit tested).
// A credit sale added its unpaid balance; credit notes and debt payments took money off it.
export function planBalanceChanges({ sales = [], creditNotes = [], payments = [] }) {
  const map = new Map();
  const add = (id, v) => { if (!id || !v) return; const k = String(id); map.set(k, (map.get(k) || 0) + v); };
  for (const s of sales) add(s.customer, -(s.balance || 0));
  for (const n of creditNotes) add(n.customer, n.amount);
  for (const p of payments) add(p.customer, p.amount);
  return [...map].map(([customer, delta]) => ({ customer, delta: r2(delta) })).filter((r) => r.delta !== 0);
}

// Start of the chosen day in shop time (UTC = Ghana), or null for "everything".
export function cutoffDate(before) {
  if (before == null || before === '') return null;
  if (typeof before !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new SaleError('Choose a valid date');
  const d = new Date(`${before}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new SaleError('Choose a valid date');
  return d;
}

// The filters for what goes. Sale-linked records follow their sale, so a refund made after the date for a sale
// before it goes too, and nothing belonging to a kept sale is touched.
const scopes = (cutoff, saleIds) => (cutoff ? {
  sales: { _id: { $in: saleIds } },
  linked: { sale: { $in: saleIds } },
  payments: { createdAt: { $lt: cutoff } },
  expenses: { date: { $lt: cutoff } },
  held: { createdAt: { $lt: cutoff } },
  shifts: { status: 'closed', closedAt: { $lt: cutoff } },
  moves: { type: { $in: SALE_MOVES }, sale: { $in: saleIds } },
} : { sales: {}, linked: {}, payments: {}, expenses: {}, held: {}, shifts: {}, moves: { type: { $in: SALE_MOVES } } });

const saleIdsBefore = async (cutoff, session) => (cutoff
  ? (await Sale.find({ createdAt: { $lt: cutoff } }).select('_id').session(session ?? null).lean()).map((s) => s._id)
  : null);

// What would be removed, without removing anything.
export function salesDataSummary(shop, { before } = {}) {
  const cutoff = cutoffDate(before);
  return runAsShop(shop, async () => {
    const ids = await saleIdsBefore(cutoff);
    const f = scopes(cutoff, ids);
    const [sales, refunds, creditNotes, payments, held, shifts, moves, first, last, later, expenses] = await Promise.all([
      Sale.countDocuments(f.sales), Refund.countDocuments(f.linked), CreditNote.countDocuments(f.linked), CustomerPayment.countDocuments(f.payments),
      HeldSale.countDocuments(f.held), Shift.countDocuments(f.shifts), StockMovement.countDocuments(f.moves),
      Sale.findOne(f.sales).sort({ createdAt: 1 }).select('createdAt').lean(),
      Sale.findOne(f.sales).sort({ createdAt: -1 }).select('createdAt').lean(),
      cutoff ? Sale.countDocuments({ createdAt: { $gte: cutoff } }) : 0,
      Expense.countDocuments(f.expenses),
    ]);
    const customersOwing = cutoff
      ? (await Sale.distinct('customer', { _id: { $in: ids }, balance: { $gt: 0 } })).length
      : await Customer.countDocuments({ balance: { $ne: 0 } });
    return { before: before || null, sales, refunds, creditNotes, debtPayments: payments, expenses, heldSales: held, shifts, stockMoves: moves, customersOwing,
      firstSale: first?.createdAt ?? null, lastSale: last?.createdAt ?? null, salesKept: later };
  });
}

async function wipe(shop, { restoreStock, cutoff }, session) {
  const o = session ? { session } : {};
  const q = (query) => query.session(session ?? null);
  const ids = await saleIdsBefore(cutoff, session);
  const f = scopes(cutoff, ids);

  let restored = [];
  if (restoreStock) {
    restored = planStockRestore(await q(StockMovement.find(f.moves).select('product type qty')).lean());
    if (restored.length) {
      await Product.bulkWrite(restored.map((r) => ({ updateOne: { filter: { _id: r.product }, update: { $inc: { stock: r.qty } } } })), o);
    }
    await StockMovement.deleteMany(f.moves, o);
  }

  // Balances: read what is about to go before deleting it.
  let changes = [];
  if (cutoff) {
    const [sales, creditNotes, payments] = await Promise.all([
      q(Sale.find({ ...f.sales, customer: { $ne: null }, balance: { $gt: 0 } }).select('customer balance')).lean(),
      q(CreditNote.find(f.linked).select('customer amount')).lean(),
      q(CustomerPayment.find(f.payments).select('customer amount')).lean(),
    ]);
    changes = planBalanceChanges({ sales, creditNotes, payments });
  }

  const del = async (Model, filter) => (await Model.deleteMany(filter, o)).deletedCount;
  const counts = {
    sales: await del(Sale, f.sales), refunds: await del(Refund, f.linked), creditNotes: await del(CreditNote, f.linked),
    debtPayments: await del(CustomerPayment, f.payments), heldSales: await del(HeldSale, f.held), shifts: await del(Shift, f.shifts),
    expenses: await del(Expense, f.expenses),
  };

  if (cutoff) {
    let reset = 0;
    for (const c of changes) {
      // Never below 0: a payment kept after the date may have paid off a debt that is being removed.
      const cust = await q(Customer.findById(c.customer).select('balance')).lean();
      if (!cust) continue;
      await Customer.updateOne({ _id: c.customer }, { $set: { balance: Math.max(0, r2((cust.balance || 0) + c.delta)) } }, o);
      reset += 1;
    }
    counts.customersReset = reset;
  } else {
    counts.customersReset = (await Customer.updateMany({ balance: { $ne: 0 } }, { $set: { balance: 0 } }, o)).modifiedCount;
    // The counter's id names the shop, so it is safe to address directly (older counters may lack the shop field).
    await Counter.deleteOne({ _id: receiptCounterId(shop) }, { ...o, skipTenant: true });
  }
  return { ...counts, before: cutoff ? cutoff.toISOString().slice(0, 10) : null, receiptsRestarted: !cutoff,
    productsRestocked: restored.length, piecesRestocked: r3(restored.reduce((t, r) => t + r.qty, 0)) };
}

// All or nothing where the database supports transactions (Atlas does); otherwise one step after another.
export function clearShopSales(shop, { restoreStock = true, before } = {}) {
  const cutoff = cutoffDate(before);
  return runAsShop(shop, async () => {
    let session;
    try {
      session = await mongoose.startSession();
      let result;
      await session.withTransaction(async () => { result = await wipe(shop, { restoreStock, cutoff }, session); });
      return result;
    } catch (err) {
      const noTx = err?.code === 20 || /replica set|Transaction numbers/i.test(err?.message || '');
      if (!noTx) throw err;
      return wipe(shop, { restoreStock, cutoff }, null);
    } finally {
      await session?.endSession();
    }
  });
}
