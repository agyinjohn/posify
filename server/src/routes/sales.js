import { Router } from 'express';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import StockMovement from '../models/StockMovement.js';
import Refund from '../models/Refund.js';
import { nextReceiptNo } from '../models/Counter.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, dayRange, num } from '../lib/validate.js';
import { PAYMENT_METHODS, r2, r3 } from '../lib/money.js';
import { priceSale, settlePayments, SaleError } from '../lib/pricing.js';
import { planReturn } from '../lib/returns.js';
import { audit } from '../lib/audit.js';
import { adjustBalance } from '../lib/balance.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

// Cashiers must not see what stock cost.
const serialize = (sale, user) => {
  const o = sale.toObject ? sale.toObject() : sale;
  if (user.role !== 'owner' && Array.isArray(o.items)) o.items = o.items.map(({ costPrice, ...rest }) => rest);
  return o;
};

router.post('/', asyncHandler(async (req, res) => {
  const { items, mode = 'retail', orderDiscount = 0, payments = [], customerId, note } = req.body;
  if (!Array.isArray(items)) throw new SaleError('Cart is empty');
  items.forEach((i) => assertId(i?.productId, 'product'));

  const products = await Product.find({ _id: { $in: items.map((i) => i.productId) }, active: true });
  const productsById = new Map(products.map((p) => [String(p._id), p]));
  const priced = priceSale({ lines: items, productsById, mode, orderDiscount });

  if (req.user.role !== 'owner' && priced.grossTotal > 0) {
    const pct = (priced.discountTotal / priced.grossTotal) * 100;
    if (pct > config.maxCashierDiscountPct) {
      throw new SaleError(`Discounts above ${config.maxCashierDiscountPct}% need the owner`, 403);
    }
  }

  const settled = settlePayments(payments, priced.total);

  let customer = null;
  if (customerId) {
    assertId(customerId, 'customer');
    customer = await Customer.findById(customerId);
    if (!customer) throw new SaleError('Customer not found', 404);
  }
  if (settled.balance > 0) {
    if (!customer) throw new SaleError('Select a customer to sell on credit');
    if (customer.creditLimit > 0 && customer.balance + settled.balance > customer.creditLimit) {
      throw new SaleError('This sale would put the customer over their credit limit', 409);
    }
  }

  // Standalone MongoDB has no transactions, so each step is atomic and we compensate on failure.
  const decremented = [];
  let sale = null;
  let creditReserved = 0;
  try {
    for (const it of priced.items) {
      const updated = await Product.findOneAndUpdate(
        { _id: it.product, stock: { $gte: it.qty } },
        { $inc: { stock: -it.qty } },
        { new: true },
      );
      if (!updated) throw new SaleError(`Not enough stock for ${it.name}`, 409);
      decremented.push(it);
    }

    // Reserve the credit atomically (limit checked inside the update) before the sale exists,
    // so concurrent credit sales cannot jointly exceed the customer's limit.
    if (settled.balance > 0) {
      const reserved = await adjustBalance(customer._id, settled.balance, { maxBalance: customer.creditLimit });
      if (!reserved) throw new SaleError('This sale would put the customer over their credit limit', 409);
      creditReserved = settled.balance;
    }

    sale = await Sale.create({
      receiptNo: await nextReceiptNo(),
      mode,
      items: priced.items,
      grossTotal: priced.grossTotal,
      subtotal: priced.subtotal,
      orderDiscount: priced.orderDiscount,
      discountTotal: priced.discountTotal,
      total: priced.total,
      payments: settled.payments,
      amountPaid: settled.amountPaid,
      change: settled.change,
      balance: settled.balance,
      customer: customer?._id,
      customerName: customer?.name,
      note: typeof note === 'string' ? note.slice(0, 200) : undefined,
      cashier: req.user._id,
    });

    await StockMovement.insertMany(
      priced.items.map((it) => ({ product: it.product, type: 'sale', qty: -it.qty, costPrice: it.costPrice, sale: sale._id, user: req.user._id })),
    );
  } catch (err) {
    if (creditReserved > 0) await adjustBalance(customer._id, -creditReserved).catch(() => {});
    if (sale) await Sale.deleteOne({ _id: sale._id }).catch(() => {});
    await Promise.all(decremented.map((it) => Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty } })));
    throw err;
  }

  res.status(201).json(serialize(sale, req.user));
}));

const PAGE_SIZE = 200;

// Newest first. Page with ?skip=N (the client asks for the next page while a full page comes back).
router.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.from || req.query.to) {
    const { start, end } = dayRange(req.query.from, req.query.to);
    filter.createdAt = { $gte: start, $lt: end };
  }
  if (['completed', 'voided', 'partial-return'].includes(req.query.status)) filter.status = req.query.status;
  if (req.user.role !== 'owner') filter.cashier = req.user._id; // cashiers see their own sales only
  const skip = Math.min(Math.max(parseInt(req.query.skip, 10) || 0, 0), 1e6);
  const sales = await Sale.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(PAGE_SIZE).populate('cashier', 'name');
  res.json(sales.map((s) => serialize(s, req.user)));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const sale = await Sale.findById(req.params.id);
  // Check ownership on the raw id: the cashier account may have been deleted since the sale.
  if (!sale || (req.user.role !== 'owner' && String(sale.cashier) !== String(req.user._id))) {
    return res.status(404).json({ error: 'Sale not found' });
  }
  await sale.populate('cashier', 'name');
  res.json(serialize(sale, req.user));
}));

const OPEN_STATUSES = ['completed', 'partial-return'];

function readReason(body, what) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3) throw new SaleError(`Give a reason for ${what}`);
  return reason.slice(0, 200);
}

function readRefundMethod(body) {
  const method = body.refundMethod ?? 'Cash';
  if (!PAYMENT_METHODS.includes(method)) throw new SaleError('Choose a valid refund method');
  return method;
}

/**
 * Shared by void and partial return (a void is a return of everything left).
 * Standalone MongoDB has no transactions, so the sale is claimed first with an optimistic
 * lock (rev): two concurrent requests cannot both return the same items. Every later step
 * is recorded with an undo, and a failure part-way rolls the earlier steps back.
 */
async function applyReturn({ sale, plan, reason, user, refundMethod, isVoid }) {
  const undo = [];
  const rollback = async () => {
    for (const fn of undo.reverse()) await fn().catch(() => {});
  };

  const set = { status: plan.fullyReturned ? 'voided' : 'partial-return' };
  const oldSet = { status: sale.status };
  for (const u of plan.updates) {
    set[`items.${u.index}.returnedQty`] = u.returnedQty;
    oldSet[`items.${u.index}.returnedQty`] = sale.items[u.index].returnedQty || 0;
  }
  if (plan.fullyReturned) Object.assign(set, { voidReason: reason, voidedBy: user._id, voidedAt: new Date() });

  const rev = sale.rev || 0;
  const claimed = await Sale.findOneAndUpdate(
    { _id: sale._id, status: { $in: OPEN_STATUSES }, ...(rev ? { rev } : { $or: [{ rev: 0 }, { rev: { $exists: false } }] }) },
    { $set: set, $inc: { rev: 1, creditReturned: plan.creditReduction, refundedTotal: plan.cashRefund } },
    { new: true },
  );
  if (!claimed) throw new SaleError('This sale was just changed by someone else. Reload and try again', 409);
  undo.push(() => Sale.updateOne(
    { _id: sale._id },
    {
      $set: oldSet,
      $unset: plan.fullyReturned ? { voidReason: '', voidedBy: '', voidedAt: '' } : {},
      $inc: { creditReturned: -plan.creditReduction, refundedTotal: -plan.cashRefund },
    },
  ));

  let { creditReduction, cashRefund } = plan;
  try {
    for (const u of plan.updates) {
      await Product.updateOne({ _id: u.productId }, { $inc: { stock: u.qty } });
      undo.push(() => Product.updateOne({ _id: u.productId, stock: { $gte: u.qty } }, { $inc: { stock: -u.qty } }));
    }

    const movements = await StockMovement.insertMany(plan.updates.map((u) => ({
      product: u.productId, type: isVoid ? 'void' : 'return', qty: u.qty, costPrice: u.costPrice, sale: sale._id,
      reason: `${isVoid ? 'Void' : 'Return'} ${sale.receiptNo}${isVoid ? '' : `: ${reason}`}`.slice(0, 200), user: user._id,
    })));
    undo.push(() => StockMovement.deleteMany({ _id: { $in: movements.map((m) => m._id) } }));

    if (creditReduction > 0) {
      const amount = creditReduction;
      const customer = await adjustBalance(sale.customer, -amount, { requireCovered: true });
      if (customer) {
        undo.push(() => adjustBalance(sale.customer, amount));
      } else {
        // The customer's balance changed under us (e.g. they just paid): hand the money back instead.
        await Sale.updateOne({ _id: sale._id }, { $inc: { creditReturned: -amount, refundedTotal: amount } });
        undo.push(() => Sale.updateOne({ _id: sale._id }, { $inc: { creditReturned: amount, refundedTotal: -amount } }));
        cashRefund = r2(cashRefund + amount);
        creditReduction = 0;
      }
    }

    if (cashRefund > 0) {
      const refund = await Refund.create({ sale: sale._id, receiptNo: sale.receiptNo, method: refundMethod, amount: cashRefund, reason, user: user._id });
      undo.push(() => Refund.deleteOne({ _id: refund._id }));
    }
  } catch (err) {
    await rollback();
    throw err;
  }

  return { creditReduction, cashRefund };
}

const respond = async (req, res, saleId, extra) => {
  const fresh = await Sale.findById(saleId).populate('cashier', 'name');
  res.json({ ...serialize(fresh, req.user), refundAmount: extra.cashRefund, creditReduced: extra.creditReduction, refundMethod: extra.cashRefund > 0 ? extra.method : null });
};

// Void: owner only. Returns everything still outstanding and cancels the sale.
router.post('/:id/void', requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const reason = readReason(req.body, 'voiding this sale');
  const refundMethod = readRefundMethod(req.body);

  const sale = await Sale.findOne({ _id: req.params.id, status: { $in: OPEN_STATUSES } });
  if (!sale) throw new SaleError('Sale not found or already voided', 409);

  const customer = sale.customer ? await Customer.findById(sale.customer).select('balance') : null;
  const plan = planReturn(sale.toObject(), { all: true, customerBalance: customer ? customer.balance : 0 });
  const result = await applyReturn({ sale, plan, reason, user: req.user, refundMethod, isVoid: true });
  audit({ req, action: 'sale.void', targetId: sale._id, detail: { receiptNo: sale.receiptNo, refund: result.cashRefund, creditReduced: result.creditReduction } });
  await respond(req, res, sale._id, { ...result, method: refundMethod });
}));

// Partial return: owner only. lines = [{ productId, qty }]. Restores stock, cancels owed credit first,
// and refunds the rest using refundMethod (default Cash).
router.post('/:id/return', requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const reason = readReason(req.body, 'the return');
  const refundMethod = readRefundMethod(req.body);

  const lines = req.body.lines;
  if (!Array.isArray(lines) || lines.length === 0) throw new SaleError('No lines provided');
  const clean = lines.map((l) => {
    assertId(l?.productId, 'product');
    return { productId: l.productId, qty: r3(num(l.qty, 'Quantity', { min: 0, max: 1e6, allowZero: false })) };
  });

  const sale = await Sale.findOne({ _id: req.params.id, status: { $in: OPEN_STATUSES } });
  if (!sale) throw new SaleError('Sale not found or already voided', 404);

  const customer = sale.customer ? await Customer.findById(sale.customer).select('balance') : null;
  const plan = planReturn(sale.toObject(), { lines: clean, customerBalance: customer ? customer.balance : 0 });
  const result = await applyReturn({ sale, plan, reason, user: req.user, refundMethod, isVoid: false });
  audit({ req, action: 'sale.return', targetId: sale._id, detail: { receiptNo: sale.receiptNo, refund: result.cashRefund, creditReduced: result.creditReduction } });
  await respond(req, res, sale._id, { ...result, method: refundMethod });
}));

export default router;
