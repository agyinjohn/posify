import { Router } from 'express';
import HeldSale from '../models/HeldSale.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import mongoose from 'mongoose';
import { assertId } from '../lib/validate.js';
import { cleanHeldItems } from '../lib/held.js';
import { SaleError } from '../lib/pricing.js';

const router = Router();
router.use(requireAuth);

// Cashiers see only their own held sales; owners see all.
router.get('/', asyncHandler(async (req, res) => {
  const filter = req.user.role === 'owner' ? {} : { cashier: req.user._id };
  res.json(await HeldSale.find(filter).sort({ createdAt: -1 }).limit(50).populate('cashier', 'name'));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { items, mode = 'retail', orderDiscount = 0, label = '' } = req.body;
  if (!['retail', 'wholesale'].includes(mode)) throw new SaleError('Invalid sale mode');
  const clean = cleanHeldItems(items, (id) => mongoose.isValidObjectId(id));
  const held = await HeldSale.create({ cashier: req.user._id, label: String(label).slice(0, 80), mode, orderDiscount: Math.max(0, Number(orderDiscount) || 0), items: clean });
  res.status(201).json(held);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const filter = { _id: req.params.id };
  if (req.user.role !== 'owner') filter.cashier = req.user._id;
  const held = await HeldSale.findOneAndDelete(filter);
  if (!held) return res.status(404).json({ error: 'Held sale not found' });
  res.json({ ok: true });
}));

export default router;
