import { Router } from 'express';
import Customer from '../models/Customer.js';
import CustomerPayment from '../models/CustomerPayment.js';
import Sale from '../models/Sale.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, dayRange, escapeRegex, num, pick } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { PAYMENT_METHODS, r2 } from '../lib/money.js';
import { adjustBalance } from '../lib/balance.js';
import { toCsv } from '../lib/csv.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const rx = new RegExp(escapeRegex(req.query.q.trim().slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { phone: rx }];
  }
  if (req.query.owing === '1') filter.balance = { $gt: 0 };
  res.json(await Customer.find(filter).sort({ name: 1 }).limit(500));
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = pick(req.body, req.user.role === 'owner' ? ['name', 'phone', 'creditLimit'] : ['name', 'phone']);
  res.status(201).json(await Customer.create(data));
}));

router.patch('/:id', requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const customer = await Customer.findByIdAndUpdate(req.params.id, pick(req.body, ['name', 'phone', 'creditLimit']), { new: true, runValidators: true });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const [sales, payments] = await Promise.all([
    Sale.find({ customer: customer._id }).sort({ createdAt: -1 }).limit(20).select('receiptNo total balance status createdAt'),
    CustomerPayment.find({ customer: customer._id }).sort({ createdAt: -1 }).limit(20),
  ]);
  res.json({ customer, sales, payments });
}));

// Customer statement: all credit sales + payments in a date range, with running balance.
router.get('/:id/statement', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const { start, end, from, to } = dayRange(req.query.from, req.query.to);

  const [sales, payments] = await Promise.all([
    Sale.find({ customer: customer._id, createdAt: { $gte: start, $lt: end }, status: 'completed', balance: { $gt: 0 } })
      .sort({ createdAt: 1 }).select('receiptNo total balance createdAt').lean(),
    CustomerPayment.find({ customer: customer._id, createdAt: { $gte: start, $lt: end } })
      .sort({ createdAt: 1 }).lean(),
  ]);

  // Merge and sort chronologically.
  const rows = [
    ...sales.map((s) => ({ date: s.createdAt, type: 'sale', ref: s.receiptNo, debit: s.balance, credit: 0 })),
    ...payments.map((p) => ({ date: p.createdAt, type: 'payment', ref: p.method, debit: 0, credit: p.amount })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Running balance starting from whatever the customer owed before this period.
  // We approximate the opening balance as: current balance - net of this period.
  const periodNet = r2(rows.reduce((s, r) => s + r.debit - r.credit, 0));
  const openingBalance = r2(customer.balance - periodNet);
  let running = openingBalance;
  const statement = rows.map((r) => {
    running = r2(running + r.debit - r.credit);
    return { ...r, balance: running };
  });

  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${customer.name.replace(/\s+/g, '-')}.csv"`);
    return res.send(toCsv(
      ['Date', 'Type', 'Reference', 'Debit (GH₵)', 'Credit (GH₵)', 'Balance (GH₵)'],
      statement.map((r) => [new Date(r.date).toISOString().slice(0, 10), r.type, r.ref, r.debit || '', r.credit || '', r.balance]),
    ));
  }

  res.json({ customer, from, to, openingBalance, closingBalance: running, statement });
}));

// Record money a customer pays toward what they owe.
router.post('/:id/payments', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const amount = r2(num(req.body.amount, 'Amount', { min: 0, max: 1e9, allowZero: false }));
  if (!PAYMENT_METHODS.includes(req.body.method)) throw new SaleError('Choose how the customer paid');
  // Atomic guard: cannot take more than they owe.
  const customer = await adjustBalance(req.params.id, -amount, { requireCovered: true });
  if (!customer) throw new SaleError('Customer not found, or amount is more than they owe', 409);
  const payment = await CustomerPayment.create({
    customer: customer._id, amount, method: req.body.method,
    note: typeof req.body.note === 'string' ? req.body.note.slice(0, 200) : undefined, user: req.user._id,
  });
  res.status(201).json({ customer, payment });
}));

export default router;
