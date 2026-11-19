import { Router } from 'express';
import Expense from '../models/Expense.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, dayRange } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { PAYMENT_METHODS, r2 } from '../lib/money.js';
import { audit } from '../lib/audit.js';
import { EXPENSE_CATEGORIES } from '../lib/expenses.js';

// Expenses: owners record and correct them; cashiers can record cash they pay out of the till (and see their own).
const router = Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function readExpense(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.amount !== undefined) {
    const amount = r2(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new SaleError('Enter an amount greater than zero');
    out.amount = amount;
  }
  if (!partial || body.category !== undefined) {
    const c = typeof body.category === 'string' ? body.category.trim().slice(0, 40) : '';
    if (!c) throw new SaleError('Choose what the expense was for');
    out.category = c;
  }
  if (!partial || body.method !== undefined) {
    if (!PAYMENT_METHODS.includes(body.method)) throw new SaleError('Choose how it was paid');
    out.method = body.method;
  }
  if (!partial || body.date !== undefined) {
    const d = typeof body.date === 'string' && DATE_RE.test(body.date) ? new Date(`${body.date}T12:00:00.000Z`) : new Date();
    if (Number.isNaN(d.getTime())) throw new SaleError('Choose a valid date');
    if (d.getTime() > Date.now() + 36 * 3_600_000) throw new SaleError('The date cannot be in the future');
    out.date = d;
  }
  for (const k of ['paidTo', 'note']) if (body[k] !== undefined) out[k] = String(body[k] ?? '').trim().slice(0, k === 'note' ? 200 : 80);
  if (body.fromTill !== undefined) out.fromTill = Boolean(body.fromTill);
  if (out.method && out.method !== 'Cash') out.fromTill = false; // only cash comes out of the drawer
  return out;
}

router.get('/categories', (_req, res) => res.json(EXPENSE_CATEGORIES));

router.get('/', asyncHandler(async (req, res) => {
  const { start, end } = dayRange(req.query.from, req.query.to);
  const filter = { date: { $gte: start, $lt: end } };
  if (req.user.role !== 'owner') filter.user = req.user._id;
  res.json(await Expense.find(filter).sort({ date: -1, createdAt: -1 }).limit(2000).populate('user', 'name').lean());
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = readExpense(req.body || {});
  if (req.user.role !== 'owner') { data.fromTill = data.method === 'Cash'; data.date = new Date(); } // cashiers: cash out of the till, today
  const e = await Expense.create({ ...data, user: req.user._id });
  audit({ req, action: 'expense.create', target: `${e.category} ${e.amount}`, targetId: e._id, detail: { amount: e.amount, category: e.category, method: e.method, fromTill: e.fromTill, paidTo: e.paidTo } });
  res.status(201).json(e);
}));

router.patch('/:id', requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const set = readExpense(req.body || {}, { partial: true });
  const e = await Expense.findByIdAndUpdate(req.params.id, { $set: set }, { new: true, runValidators: true });
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  audit({ req, action: 'expense.edit', target: `${e.category} ${e.amount}`, targetId: e._id, detail: set });
  res.json(e);
}));

router.delete('/:id', requireOwner, asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const e = await Expense.findByIdAndDelete(req.params.id);
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  audit({ req, action: 'expense.delete', target: `${e.category} ${e.amount}`, targetId: e._id, detail: { amount: e.amount, date: e.date, method: e.method } });
  res.json({ ok: true });
}));

export default router;
