import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import User from '../models/User.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { tokenRevoked } from '../lib/password.js';

// Every request re-checks the account so deactivation and role changes apply at once. A page load fires many
// requests in parallel, so keep the lookup for a few seconds; changes made through this server clear it immediately.
const USER_TTL_MS = 5000;
const userCache = new Map(); // id -> { user, exp }
export const forgetUser = (id) => userCache.delete(String(id));

async function loadUser(id) {
  const hit = userCache.get(id);
  if (hit && hit.exp > Date.now()) return hit.user;
  const user = await User.findById(id);
  if (user) {
    userCache.set(id, { user, exp: Date.now() + USER_TTL_MS });
    if (userCache.size > 500) userCache.clear();
  } else userCache.delete(id);
  return user;
}

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '12h' });

// allowPasswordChange: the few routes a user with a temporary password may still use (read who they are, change it).
const buildAuth = ({ allowPasswordChange }) => asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again' });
  }

  // Re-check the user on every request so deactivation and role changes apply immediately.
  const user = await loadUser(payload.sub);
  if (!user || !user.active) return res.status(401).json({ error: 'Account is not active' });
  // A password change or reset signs out every session that existed before it.
  if (tokenRevoked(payload.iat, user.passwordChangedAt)) return res.status(401).json({ error: 'Your password was changed. Sign in again' });
  if (user.mustChangePassword && !allowPasswordChange) {
    return res.status(403).json({ error: 'Choose a new password to continue', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  req.user = user;
  next();
});

export const requireAuth = buildAuth({ allowPasswordChange: false });
export const requireAuthAllowingPasswordChange = buildAuth({ allowPasswordChange: true });

export const requireOwner = (req, res, next) =>
  req.user?.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this' });
