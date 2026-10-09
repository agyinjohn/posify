import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import User from '../models/User.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '12h' });

export const requireAuth = asyncHandler(async (req, res, next) => {
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
  const user = await User.findById(payload.sub);
  if (!user || !user.active) return res.status(401).json({ error: 'Account is not active' });
  req.user = user;
  next();
});

export const requireOwner = (req, res, next) =>
  req.user?.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this' });
