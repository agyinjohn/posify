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
import CreditNote from '../models/CreditNote.js';
import { buildStatement, netMovement } from '../lib/statement.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const rx = new RegExp(escapeRegex(req.query.q.trim().slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { phone: rx }];
  }
  if (req.query.owing === '1') filter.balance = { $gt: 0 };
  res.json(await Customer.find(filter).sort({ name: 1 }).limit(2000));
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = pick(req.body, req.user.role === 'owner' ? ['name', 'phone', 'creditLimit'] : ['name', 'phone']);
  res.status(201).json(await Customer.create(data));
}));

router.patch('/:id', requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const customer = await Customer.findByIdAndUpdate(req.params.id, pick(req.body, ['name', 'phone', 'creditLimit']), { new: true, runValidators: true });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  audit({ req, action: 'customer.edit', target: customer.name, targetId: customer._id, detail: pick(req.body, ['name', 'phone', 'creditLimit']) });
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

  const inRange = { customer: customer._id, createdAt: { $gte: start, $lt: end } };
  const after = { customer: customer._id, createdAt: { $gte: end } };
  const [sales, notes, payments, laterSales, laterNotes, laterPayments] = await Promise.all([
    Sale.find({ ...inRange, balance: { $gt: 0 } }).sort({ createdAt: 1 }).select('receiptNo total balance status creditReturned createdAt').lean(),
    CreditNote.find(inRange).sort({ createdAt: 1 }).lean(),
    CustomerPayment.find(inRange).sort({ createdAt: 1 }).lean(),
    Sale.find({ ...after, balance: { $gt: 0 } }).select('balance status creditReturned').lean(),
    CreditNote.find(after).select('amount').lean(),
    CustomerPayment.find(after).select('amount').lean(),
  ]);
  const afterNet = netMovement({ sales: laterSales, notes: laterNotes, payments: laterPayments });
  const { openingBalance, closingBalance, statement } = buildStatement({ sales, notes, payments, currentBalance: customer.balance, afterNet });

  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${customer.name.replace(/\s+/g, '-')}.csv"`);
    return res.send(toCsv(
      ['Date', 'Type', 'Reference', 'Debit (GH₵)', 'Credit (GH₵)', 'Balance (GH₵)'],
      statement.map((r) => [new Date(r.date).toISOString().slice(0, 10), r.type, r.ref, r.debit || '', r.credit || '', r.balance]),
    ));
  }

  res.json({ customer, from, to, openingBalance, closingBalance, statement });
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
  audit({ req, action: 'customer.payment', target: customer.name, targetId: customer._id, detail: { amount, method: req.body.method } });
  res.status(201).json({ customer, payment });
}));

export default router;
