import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import User from '../models/User.js';
import Shop from '../models/Shop.js';
import PlatformAdmin from '../models/PlatformAdmin.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { tokenRevoked } from '../lib/password.js';
import { runAsShop } from '../lib/tenant.js';

// Every request re-checks the account and its shop, so deactivation, role changes and suspensions apply at once.
// A page load fires many requests in parallel, so keep the lookups for a few seconds; changes made through this
// server clear them immediately.
const TTL_MS = 5000;
const cache = (load) => {
  const map = new Map();
  const get = async (id) => {
    const key = String(id);
    const hit = map.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
    const value = await load(key);
    if (value) { map.set(key, { value, exp: Date.now() + TTL_MS }); if (map.size > 1000) map.clear(); } else map.delete(key);
    return value;
  };
  return { get, forget: (id) => map.delete(String(id)) };
};
const users = cache((id) => User.findById(id).setOptions({ skipTenant: true })); // the user's shop is not known yet
const shops = cache((id) => Shop.findById(id));
export const forgetUser = users.forget;
export const forgetShop = shops.forget;
export const loadShop = shops.get;

// Shop tokens are signed with the user's shop id; platform-admin tokens have their own audience, so neither works
// in the other's routes.
export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role, shop: String(user.shop) }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '12h', audience: 'shop' });
export const signAdminToken = (admin) =>
  jwt.sign({ sub: String(admin._id) }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '8h', audience: 'platform' });

const bearer = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

// allowPasswordChange: the few routes a user with a temporary password may still use (read who they are, change it).
const buildAuth = ({ allowPasswordChange }) => asyncHandler(async (req, res, next) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again' });
  }
  if (payload.aud === 'platform') return res.status(401).json({ error: 'Sign in to the shop to continue' });

  const user = await users.get(payload.sub);
  if (!user || !user.active || !user.shop) return res.status(401).json({ error: 'Account is not active' });
  // The shop comes from the account on record; a token naming another shop is refused outright.
  if (payload.shop && payload.shop !== String(user.shop)) return res.status(401).json({ error: 'Sign in again' });
  // A password change or reset signs out every session that existed before it.
  if (tokenRevoked(payload.iat, user.passwordChangedAt)) return res.status(401).json({ error: 'Your password was changed. Sign in again' });

  const shop = await shops.get(user.shop);
  // 403, not 401: the app shows the message instead of quietly signing out.
  if (!shop || !shop.active) return res.status(403).json({ error: 'This shop is suspended. Contact your provider', code: 'SHOP_SUSPENDED' });
  if (user.mustChangePassword && !allowPasswordChange) {
    return res.status(403).json({ error: 'Choose a new password to continue', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  req.user = user;
  req.shop = shop;
  // Everything this request does from here on reads and writes only this shop's data (lib/tenant.js).
  return runAsShop(user.shop, () => next());
});

export const requireAuth = buildAuth({ allowPasswordChange: false });
export const requireAuthAllowingPasswordChange = buildAuth({ allowPasswordChange: true });

export const requireOwner = (req, res, next) =>
  req.user?.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this' });

// ── Platform admin ──
const admins = cache((id) => PlatformAdmin.findById(id));
export const forgetAdmin = admins.forget;
export const requireAdmin = asyncHandler(async (req, res, next) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], audience: 'platform' });
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again' });
  }
  const admin = await admins.get(payload.sub);
  if (!admin || !admin.active) return res.status(401).json({ error: 'Account is not active' });
  if (tokenRevoked(payload.iat, admin.passwordChangedAt)) return res.status(401).json({ error: 'Your password was changed. Sign in again' });
  req.admin = admin;
  next();
});
