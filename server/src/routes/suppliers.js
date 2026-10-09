import { Router } from 'express';
import Supplier from '../models/Supplier.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, escapeRegex, pick } from '../lib/validate.js';

const router = Router();
router.use(requireAuth, requireOwner);

const FIELDS = ['name', 'phone', 'email', 'address', 'notes'];

router.get('/', asyncHandler(async (req, res) => {
  const filter = { active: true };
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const rx = new RegExp(escapeRegex(req.query.q.trim().slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { phone: rx }];
  }
  res.json(await Supplier.find(filter).sort({ name: 1 }).limit(200));
}));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json(await Supplier.create(pick(req.body, FIELDS)));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const supplier = await Supplier.findByIdAndUpdate(
    req.params.id, pick(req.body, [...FIELDS, 'active']), { new: true, runValidators: true },
  );
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  res.json(supplier);
}));

export default router;
