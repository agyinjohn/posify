import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { requireAuth, requireOwner, forgetUser } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId, pick } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { audit } from '../lib/audit.js';
import { checkPassword } from '../lib/password.js';

const router = Router();
router.use(requireAuth, requireOwner);

router.get('/', asyncHandler(async (_req, res) => res.json(await User.find().sort({ name: 1 }))));

router.post('/', asyncHandler(async (req, res) => {
  checkPassword(req.body.password, req.body.username);
  const user = await User.create({
    ...pick(req.body, ['name', 'username']),
    role: req.body.role === 'owner' ? 'owner' : 'cashier',
    passwordHash: await bcrypt.hash(req.body.password, 12),
    mustChangePassword: true, // the owner chose this one, so the new user picks their own at first sign-in
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
    // Your own password goes through "Change password" (it needs the current one and keeps you signed in).
    if (String(req.user._id) === req.params.id) throw new SaleError('Use "Change password" in your profile menu to change your own password');
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    checkPassword(req.body.password, target.username);
    update.passwordHash = await bcrypt.hash(req.body.password, 12);
    update.passwordChangedAt = new Date(); // signs them out everywhere
    update.mustChangePassword = true;      // a temporary password: they choose their own next time
  }
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  forgetUser(req.params.id); // role / active changes take effect on the very next request
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body.password) audit({ req, action: 'user.password.reset', target: user.username, targetId: user._id });
  audit({ req, action: 'user.edit', target: user.username, targetId: user._id, detail: Object.keys(update).filter((k) => !['passwordHash', 'passwordChangedAt', 'mustChangePassword'].includes(k)).reduce((o, k) => ({ ...o, [k]: update[k] }), {}) });
  res.json(user);
}));

export default router;
