import { Router } from 'express';
import Shift from '../models/Shift.js';
import Sale from '../models/Sale.js';
import CustomerPayment from '../models/CustomerPayment.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, num } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { PAYMENT_METHODS, r2 } from '../lib/money.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// GET /api/shifts/current — the open shift (any user can check)
router.get('/current', asyncHandler(async (_req, res) => {
  const shift = await Shift.findOne({ status: 'open' }).sort({ createdAt: -1 }).populate('openedBy', 'name');
  res.json(shift ?? null);
}));

// GET /api/shifts — history, most recent first (owner only)
router.get('/', asyncHandler(async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can view shift history' });
  const shifts = await Shift.find().sort({ createdAt: -1 }).limit(100)
    .populate('openedBy', 'name').populate('closedBy', 'name');
  res.json(shifts);
}));

// POST /api/shifts/open
router.post('/open', asyncHandler(async (req, res) => {
  const existing = await Shift.findOne({ status: 'open' });
  if (existing) throw new SaleError('A shift is already open', 409);
  const openingFloat = r2(num(req.body.openingFloat ?? 0, 'Opening float', { min: 0, max: 1e9 }));
  const shift = await Shift.create({
    openedBy: req.user._id,
    openedByName: req.user.name,
    openingFloat,
    note: typeof req.body.note === 'string' ? req.body.note.slice(0, 200) : '',
  });
  audit({ req, action: 'shift.open', targetId: shift._id, detail: { openingFloat } });
  res.status(201).json(shift);
}));

// POST /api/shifts/:id/close
router.post('/:id/close', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const shift = await Shift.findOne({ _id: req.params.id, status: 'open' });
  if (!shift) throw new SaleError('Shift not found or already closed', 404);

  const closingCash = r2(num(req.body.closingCash ?? 0, 'Closing cash', { min: 0, max: 1e9 }));

  // Summarise all sales and customer payments that happened during this shift.
  const [sales, custPayments] = await Promise.all([
    Sale.find({ createdAt: { $gte: shift.createdAt }, status: 'completed' }).lean(),
    CustomerPayment.find({ createdAt: { $gte: shift.createdAt } }).lean(),
  ]);

  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]));
  let total = 0, discounts = 0, creditGiven = 0;
  for (const s of sales) {
    total += s.total;
    discounts += s.discountTotal || 0;
    creditGiven += s.balance || 0;
    for (const p of s.payments) byMethod[p.method] = r2(byMethod[p.method] + p.amount);
  }
  let debtCollected = 0;
  for (const p of custPayments) {
    byMethod[p.method] = r2(byMethod[p.method] + p.amount);
    debtCollected += p.amount;
  }

  const summary = {
    salesCount: sales.length,
    total: r2(total),
    discounts: r2(discounts),
    creditGiven: r2(creditGiven),
    debtCollected: r2(debtCollected),
    byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, r2(v)])),
    expectedCash: r2(shift.openingFloat + byMethod['Cash']),
    cashVariance: r2(closingCash - (shift.openingFloat + byMethod['Cash'])),
  };

  shift.closedBy = req.user._id;
  shift.closedByName = req.user.name;
  shift.closingCash = closingCash;
  shift.note = typeof req.body.note === 'string' ? req.body.note.slice(0, 200) : shift.note;
  shift.status = 'closed';
  shift.closedAt = new Date();
  await shift.save();

  audit({ req, action: 'shift.close', targetId: shift._id, detail: { closingCash, cashVariance: summary.cashVariance } });
  res.json({ shift, summary });
}));

export default router;
