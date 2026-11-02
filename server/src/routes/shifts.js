import { Router } from 'express';
import Shift from '../models/Shift.js';
import Sale from '../models/Sale.js';
import CustomerPayment from '../models/CustomerPayment.js';
import Refund from '../models/Refund.js';
import { cashUp } from '../lib/cashup.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, num } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { r2 } from '../lib/money.js';
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
  let shift;
  try {
    shift = await Shift.create({
      openedBy: req.user._id,
      openedByName: req.user.name,
      openingFloat,
      note: typeof req.body.note === 'string' ? req.body.note.slice(0, 200) : '',
    });
  } catch (err) {
    if (err.code === 11000) throw new SaleError('A shift is already open', 409); // lost a race with another till
    throw err;
  }
  audit({ req, action: 'shift.open', targetId: shift._id, detail: { openingFloat } });
  res.status(201).json(shift);
}));

// POST /api/shifts/:id/close
router.post('/:id/close', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const open = await Shift.findOne({ _id: req.params.id, status: 'open' });
  if (!open) throw new SaleError('Shift not found or already closed', 404);

  const closingCash = r2(num(req.body.closingCash ?? 0, 'Closing cash', { min: 0, max: 1e9 }));

  // Everything that happened since the shift opened. Voided and partly returned sales are included:
  // their payments went into the till and the Refund rows take the money back out.
  const since = { createdAt: { $gte: open.createdAt } };
  const [sales, custPayments, refunds] = await Promise.all([
    Sale.find(since).lean(),
    CustomerPayment.find(since).lean(),
    Refund.find(since).lean(),
  ]);
  const summary = cashUp({ sales, custPayments, refunds, openingFloat: open.openingFloat, closingCash });

  // Claim the close atomically so two tills closing at once cannot both succeed.
  const shift = await Shift.findOneAndUpdate(
    { _id: open._id, status: 'open' },
    {
      $set: {
        status: 'closed', closedAt: new Date(), closedBy: req.user._id, closedByName: req.user.name,
        closingCash, expectedCash: summary.expectedCash, cashVariance: summary.cashVariance, summary,
        note: typeof req.body.note === 'string' ? req.body.note.slice(0, 200) : open.note,
      },
    },
    { new: true },
  );
  if (!shift) throw new SaleError('Shift not found or already closed', 409);

  audit({ req, action: 'shift.close', targetId: shift._id, detail: { closingCash, cashVariance: summary.cashVariance } });
  res.json({ shift, summary });
}));

export default router;
