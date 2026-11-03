import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import { signToken, requireAuth, requireAuthAllowingPasswordChange, forgetUser } from '../middleware/auth.js';
import { checkPassword } from '../lib/password.js';
import { generateCodes, findCode, remaining, FailureTracker, CODE_COUNT } from '../lib/recoveryCodes.js';
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

// ── Owner recovery codes ────────────────────────────────────────────────────────────────────────
// Generated while signed in (needs the current password), shown once, used on the login page's "Forgot password?".
const ownerOnly = (req, res, next) => (req.user.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner has recovery codes' }));

router.get('/recovery-codes', requireAuth, ownerOnly, asyncHandler(async (req, res) => {
  const u = await User.findById(req.user._id).select('+recoveryCodes');
  res.json({ remaining: remaining(u.recoveryCodes), total: CODE_COUNT, createdAt: u.recoveryCodesCreatedAt });
}));

router.post('/recovery-codes', requireAuth, ownerOnly, changeLimiter, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash +recoveryCodes');
  if (!(await bcrypt.compare(String(req.body?.currentPassword ?? ''), user.passwordHash))) {
    audit({ req, action: 'recovery.generate.fail' });
    throw new SaleError('Your current password is wrong');
  }
  const { codes, records } = await generateCodes();
  user.recoveryCodes = records; // replaces any earlier set: the old codes stop working
  user.recoveryCodesCreatedAt = new Date();
  await user.save();
  audit({ req, action: 'recovery.generate', targetId: user._id });
  res.json({ codes, total: CODE_COUNT, createdAt: user.recoveryCodesCreatedAt });
}));

// Public "Forgot password?": username + one recovery code + new password. Every failure looks the same
// (no hint whether the username exists), attempts are throttled per username and per IP, and a code works once.
const recoverIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes' } });
const recoverFailures = new FailureTracker({ limit: 5, windowMs: 15 * 60_000 });
const RECOVER_FAIL = 'That username and recovery code do not match';

router.post('/recover', recoverIpLimiter, asyncHandler(async (req, res) => {
  const { username, code, newPassword } = req.body || {};
  if (typeof username !== 'string' || typeof code !== 'string' || !username.trim() || !code.trim()) {
    return res.status(400).json({ error: 'Enter your username, a recovery code and a new password' });
  }
  const key = username.toLowerCase().trim();
  if (recoverFailures.isLocked(key)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes' });

  const user = await User.findOne({ username: key, role: 'owner', active: true }).select('+recoveryCodes');
  const records = user?.recoveryCodes ?? [];
  const index = await findCode(records, code);
  if (!user || index === -1) {
    recoverFailures.fail(key);
    audit({ req, action: 'recovery.fail', username: key });
    return res.status(400).json({ error: RECOVER_FAIL });
  }
  checkPassword(newPassword, user.username); // a valid code is not spent on a weak password

  // Spend the code atomically: if two requests race with the same code, only one wins.
  const spent = await User.findOneAndUpdate(
    { _id: user._id, [`recoveryCodes.${index}.hash`]: records[index].hash, [`recoveryCodes.${index}.usedAt`]: null },
    { $set: { [`recoveryCodes.${index}.usedAt`]: new Date(), passwordHash: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date(), mustChangePassword: false } },
  );
  if (!spent) return res.status(400).json({ error: RECOVER_FAIL });
  recoverFailures.clear(key);
  forgetUser(user._id);
  audit({ req, action: 'recovery.reset', username: key, targetId: user._id, detail: { codesLeft: remaining(records) - 1 } });
  res.json({ ok: true, codesLeft: remaining(records) - 1 });
}));

export default router;
