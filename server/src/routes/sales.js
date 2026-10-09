import { Router } from 'express';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import StockMovement from '../models/StockMovement.js';
import { nextReceiptNo } from '../models/Counter.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, dayRange, num } from '../lib/validate.js';
import { r2 } from '../lib/money.js';
import { priceSale, settlePayments, SaleError } from '../lib/pricing.js';
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
    if (settled.balance > 0) await adjustBalance(customer._id, settled.balance);
  } catch (err) {
    if (sale) await Sale.deleteOne({ _id: sale._id }).catch(() => {});
    await Promise.all(decremented.map((it) => Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty } })));
    throw err;
  }

  res.status(201).json(serialize(sale, req.user));
}));

router.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.from || req.query.to) {
    const { start, end } = dayRange(req.query.from, req.query.to);
    filter.createdAt = { $gte: start, $lt: end };
  }
  if (['completed', 'voided'].includes(req.query.status)) filter.status = req.query.status;
  if (req.user.role !== 'owner') filter.cashier = req.user._id; // cashiers see their own sales only
  const sales = await Sale.find(filter).sort({ createdAt: -1 }).limit(200).populate('cashier', 'name');
  res.json(sales.map((s) => serialize(s, req.user)));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const sale = await Sale.findById(req.params.id).populate('cashier', 'name');
  if (!sale || (req.user.role !== 'owner' && String(sale.cashier._id) !== String(req.user._id))) {
    return res.status(404).json({ error: 'Sale not found' });
  }
  res.json(serialize(sale, req.user));
}));

// Void: owner only. Status flips atomically first so a sale can never be voided twice.
router.post('/:id/void', requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3) throw new SaleError('Give a reason for voiding this sale');

  const sale = await Sale.findOneAndUpdate(
    { _id: req.params.id, status: 'completed' },
    { status: 'voided', voidReason: reason.slice(0, 200), voidedBy: req.user._id, voidedAt: new Date() },
    { new: true },
  );
  if (!sale) throw new SaleError('Sale not found or already voided', 409);

  await Promise.all(sale.items.map((it) => Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty } })));
  await StockMovement.insertMany(
    sale.items.map((it) => ({ product: it.product, type: 'void', qty: it.qty, sale: sale._id, reason: `Void ${sale.receiptNo}`, user: req.user._id })),
  );
  if (sale.customer && sale.balance > 0) await adjustBalance(sale.customer, -sale.balance);
  res.json(sale);
}));

// Partial return: owner only. lines = [{ productId, qty }]. Restores stock and reduces credit balance.
router.post('/:id/return', requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3) throw new SaleError('Give a reason for the return');

  const lines = req.body.lines;
  if (!Array.isArray(lines) || lines.length === 0) throw new SaleError('No lines provided');

  const sale = await Sale.findOne({ _id: req.params.id, status: { $in: ['completed', 'partial-return'] } });
  if (!sale) throw new SaleError('Sale not found or already voided', 404);

  // Validate each return line against the original sale items.
  const updates = [];
  for (const l of lines) {
    assertId(l?.productId, 'product');
    const qty = r2(num(l.qty, 'Quantity', { min: 0, max: 1e6, allowZero: false }));
    const item = sale.items.find((i) => String(i.product) === String(l.productId));
    if (!item) throw new SaleError(`Product not found in this sale`);
    const alreadyReturned = item.returnedQty || 0;
    if (alreadyReturned + qty > item.qty) {
      throw new SaleError(`Cannot return more than sold for ${item.name} (sold ${item.qty}, already returned ${alreadyReturned})`);
    }
    updates.push({ item, qty });
  }

  // Apply returnedQty increments on the sale document.
  for (const { item, qty } of updates) {
    item.returnedQty = r2((item.returnedQty || 0) + qty);
  }

  // If every line is fully returned, mark as voided; otherwise partial-return.
  const fullyReturned = sale.items.every((i) => (i.returnedQty || 0) >= i.qty);
  sale.status = fullyReturned ? 'voided' : 'partial-return';
  if (fullyReturned) { sale.voidReason = reason; sale.voidedBy = req.user._id; sale.voidedAt = new Date(); }
  await sale.save();

  // Restore stock.
  await Promise.all(updates.map(({ item, qty }) => Product.updateOne({ _id: item.product }, { $inc: { stock: qty } })));

  // Write stock movements.
  await StockMovement.insertMany(
    updates.map(({ item, qty }) => ({
      product: item.product, type: 'void', qty, sale: sale._id,
      reason: `Return ${sale.receiptNo}: ${reason}`, user: req.user._id,
    })),
  );

  // Reduce credit balance proportionally if the sale had an unpaid balance.
  if (sale.customer && sale.balance > 0) {
    const returnedValue = r2(updates.reduce((s, { item, qty }) => {
      const unitNet = r2(item.lineTotal / item.qty);
      return s + r2(unitNet * qty);
    }, 0));
    const creditReduction = r2(Math.min(returnedValue, sale.balance));
    if (creditReduction > 0) await adjustBalance(sale.customer, -creditReduction);
  }

  res.json(serialize(sale, req.user));
}));

export default router;
