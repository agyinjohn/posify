import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, pick } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, requireOwner);

const checkPassword = (p) => {
  if (typeof p !== 'string' || p.length < 8) throw new SaleError('Password must be at least 8 characters');
};

router.get('/', asyncHandler(async (_req, res) => res.json(await User.find().sort({ name: 1 }))));

router.post('/', asyncHandler(async (req, res) => {
  checkPassword(req.body.password);
  const user = await User.create({
    ...pick(req.body, ['name', 'username']),
    role: req.body.role === 'owner' ? 'owner' : 'cashier',
    passwordHash: await bcrypt.hash(req.body.password, 12),
  });
  audit({ req, action: 'user.create', target: user.username, targetId: user._id, detail: { role: user.role } });
  res.status(201).json(user);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const update = pick(req.body, ['name', 'role', 'active']);
  if (update.role && !['owner', 'cashier'].includes(update.role)) throw new SaleError('Invalid role');
  if (String(req.user._id) === req.params.id && (update.active === false || update.role === 'cashier')) {
    throw new SaleError("You can't deactivate or demote your own account");
  }
  if (req.body.password) {
    checkPassword(req.body.password);
    update.passwordHash = await bcrypt.hash(req.body.password, 12);
  }
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!user) return res.status(404).json({ error: 'User not found' });
  audit({ req, action: 'user.edit', target: user.username, targetId: user._id, detail: Object.keys(update).filter((k) => k !== 'passwordHash').reduce((o, k) => ({ ...o, [k]: update[k] }), {}) });
  res.json(user);
}));

export default router;
