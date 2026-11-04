import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import Shop from '../models/Shop.js';
import User from '../models/User.js';
import PlatformAdmin from '../models/PlatformAdmin.js';
import { requireAdmin, signAdminToken, forgetUser, forgetShop, forgetAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { assertId } from '../lib/validate.js';
import { SaleError } from '../lib/pricing.js';
import { checkPassword } from '../lib/password.js';
import { seal, open, tempPassword } from '../lib/secretBox.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';

/**
 * Platform admin: the people who run the service create shops, see an owner's temporary password until the owner
 * replaces it, rename shops, suspend / reactivate them, and reset an owner's password. They never see a shop's
 * sales, products or customers. Every action is also written to that shop's own audit log.
 */
const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes' } });
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const SKIP = { skipTenant: true }; // the admin works across shops

router.post('/login', limiter, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) throw new SaleError('Enter your username and password');
  const admin = await PlatformAdmin.findOne({ username: username.toLowerCase().trim() }).select('+passwordHash');
  const ok = await bcrypt.compare(password, admin ? admin.passwordHash : DUMMY_HASH);
  if (!admin || !admin.active || !ok) return res.status(401).json({ error: 'Wrong username or password' });
  res.json({ token: signAdminToken(admin), admin });
}));

router.use(requireAdmin);

router.get('/me', (req, res) => res.json({ admin: req.admin }));

router.post('/password', asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const admin = await PlatformAdmin.findById(req.admin._id).select('+passwordHash');
  if (!(await bcrypt.compare(String(currentPassword ?? ''), admin.passwordHash))) throw new SaleError('Your current password is wrong');
  checkPassword(newPassword, admin.username);
  admin.passwordHash = await bcrypt.hash(newPassword, 12);
  admin.passwordChangedAt = new Date();
  await admin.save();
  forgetAdmin(admin._id);
  res.json({ token: signAdminToken(admin), admin });
}));

const view = (shop, owner) => ({
  id: shop._id,
  name: shop.name,
  active: shop.active,
  notes: shop.notes,
  createdAt: shop.createdAt,
  owner: owner ? { id: owner._id, name: owner.name, username: owner.username, active: owner.active } : null,
  // Readable only until the owner sets their own password; after that it no longer exists.
  tempPassword: shop.tempPassword ? open(shop.tempPassword, config.jwtSecret) : null,
  tempPasswordSetAt: shop.tempPasswordSetAt,
  ownerPasswordChangedAt: shop.ownerPasswordChangedAt,
});

router.get('/shops', asyncHandler(async (_req, res) => {
  const shops = await Shop.find().sort({ createdAt: -1 }).select('+tempPassword');
  const owners = await User.find({ _id: { $in: shops.map((s) => s.owner).filter(Boolean) } }).setOptions(SKIP);
  const byId = new Map(owners.map((o) => [String(o._id), o]));
  res.json(shops.map((s) => view(s, byId.get(String(s.owner)))));
}));

const cleanName = (v, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 2 || s.length > 80) throw new SaleError(`${label} must be 2 to 80 characters`);
  return s;
};
const cleanUsername = (v) => {
  const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
  if (!/^[a-z0-9._-]{3,40}$/.test(s)) throw new SaleError('Username: 3 to 40 letters, numbers, dots, dashes or underscores');
  return s;
};

// Create a shop and its owner. The owner gets a temporary password, shown here until they choose their own.
router.post('/shops', asyncHandler(async (req, res) => {
  const name = cleanName(req.body?.name, 'Shop name');
  const ownerName = cleanName(req.body?.ownerName, "Owner's name");
  const username = cleanUsername(req.body?.ownerUsername);
  // Usernames are unique across every shop: that is how sign-in finds the shop.
  if (await User.exists({ username }).setOptions(SKIP)) throw new SaleError('That username is already taken. Choose another', 409);

  const password = tempPassword();
  const shop = await Shop.create({ name, notes: typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 300) : '', tempPassword: seal(password, config.jwtSecret), tempPasswordSetAt: new Date() });
  let owner;
  try {
    owner = await User.create({ shop: shop._id, name: ownerName, username, role: 'owner', passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true });
  } catch (err) {
    await Shop.deleteOne({ _id: shop._id }); // no half-made shops
    throw err;
  }
  shop.owner = owner._id;
  await shop.save();
  audit({ req, action: 'platform.shop.create', username: `admin:${req.admin.username}`, target: name, targetId: shop._id, shop: shop._id });
  res.status(201).json(view(shop, owner));
}));

router.patch('/shops/:id', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const set = {};
  if (req.body?.name !== undefined) set.name = cleanName(req.body.name, 'Shop name');
  if (req.body?.notes !== undefined) set.notes = String(req.body.notes).slice(0, 300);
  if (req.body?.active !== undefined) set.active = Boolean(req.body.active);
  const shop = await Shop.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).select('+tempPassword');
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  forgetShop(shop._id); // suspensions apply on the shop's very next request
  const owner = shop.owner ? await User.findById(shop.owner).setOptions(SKIP) : null;
  const action = set.active === false ? 'platform.shop.suspend' : set.active === true ? 'platform.shop.reactivate' : 'platform.shop.edit';
  audit({ req, action, username: `admin:${req.admin.username}`, target: shop.name, targetId: shop._id, detail: set, shop: shop._id });
  res.json(view(shop, owner));
}));

// New temporary password for the owner: signs them out everywhere and makes them choose their own at sign-in.
router.post('/shops/:id/reset-owner', asyncHandler(async (req, res) => {
  assertId(req.params.id);
  const shop = await Shop.findById(req.params.id);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  let owner = shop.owner ? await User.findById(shop.owner).setOptions(SKIP) : null;
  if (!owner) owner = await User.findOne({ shop: shop._id, role: 'owner' }).sort({ createdAt: 1 }).setOptions(SKIP);
  if (!owner) throw new SaleError('This shop has no owner account to reset', 409);

  const password = tempPassword();
  await User.updateOne({ _id: owner._id }, { $set: { passwordHash: await bcrypt.hash(password, 12), passwordChangedAt: new Date(), mustChangePassword: true, active: true } }).setOptions(SKIP);
  forgetUser(owner._id);
  const updated = await Shop.findByIdAndUpdate(shop._id, { $set: { owner: owner._id, tempPassword: seal(password, config.jwtSecret), tempPasswordSetAt: new Date(), ownerPasswordChangedAt: null } }, { new: true }).select('+tempPassword');
  forgetShop(shop._id);
  audit({ req, action: 'platform.owner.reset', username: `admin:${req.admin.username}`, target: owner.username, targetId: owner._id, shop: shop._id });
  res.json(view(updated, await User.findById(owner._id).setOptions(SKIP)));
}));

export default router;
