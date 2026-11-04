import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import { forgetUser } from '../middleware/auth.js';
import { checkPassword } from './password.js';
import { pickOwner, resetFingerprint } from './ownerReset.js';

/**
 * Set a new (temporary) password on the owner account. Signs out every existing session, re-activates the
 * account if it was disabled, and makes the owner choose their own password at the next sign-in.
 * With skipIfApplied, the same value is applied only once (safe to leave the env var set across restarts).
 */
export async function applyOwnerReset({ password, username, secret, skipIfApplied = true }) {
  // Across all shops: with more than one owner, RESET_OWNER_USERNAME says which (usernames are unique platform-wide).
  const owners = await User.find({ role: 'owner' }).select('+ownerResetFingerprint').setOptions({ skipTenant: true });
  const target = pickOwner(owners, username);
  checkPassword(password, target.username);

  const fingerprint = resetFingerprint(password, secret);
  if (skipIfApplied && target.ownerResetFingerprint === fingerprint) return { status: 'already-applied', username: target.username };

  target.passwordHash = await bcrypt.hash(password, 12);
  target.passwordChangedAt = new Date();
  target.mustChangePassword = true;
  target.active = true;
  target.ownerResetFingerprint = fingerprint;
  await target.save();
  forgetUser(target._id);
  await AuditLog.create({ shop: target.shop, action: 'owner.reset', username: target.username, target: target.username, targetId: target._id, detail: { via: 'server recovery' } });
  return { status: 'reset', username: target.username };
}
