import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import { signToken, requireAuth, requireAuthAllowingPasswordChange, forgetUser } from '../middleware/auth.js';
import { checkPassword } from '../lib/password.js';
import { SaleError } from '../lib/pricing.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { audit } from '../lib/audit.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes' } });

// Compared against when the username does not exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

router.post('/login', limiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Enter your username and password' });
  }
  const user = await User.findOne({ username: username.toLowerCase().trim() }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !user.active || !ok) {
    audit({ req, action: 'login.fail', username: username.toLowerCase().trim() });
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  audit({ req, action: 'login.success', username: user.username, targetId: user._id });
  res.json({ token: signToken(user), user });
}));

router.get('/me', requireAuthAllowingPasswordChange, (req, res) => res.json({ user: req.user }));

// Change your own password (also the way out of a temporary one). Everyone else's sessions on this account end,
// this one continues with the fresh token returned here.
const changeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes' } });

router.post('/change-password', requireAuthAllowingPasswordChange, changeLimiter, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword) throw new SaleError('Enter your current password');
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    audit({ req, action: 'password.change.fail' });
    // 400, not 401: the browser treats 401 as an expired session and would sign the user out.
    throw new SaleError('Your current password is wrong');
  }
  checkPassword(newPassword, user.username);
  if (newPassword === currentPassword) throw new SaleError('Choose a password different from the current one');

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  await user.save();
  forgetUser(user._id);
  audit({ req, action: 'password.change', targetId: user._id });
  res.json({ token: signToken(user), user });
}));

export default router;
