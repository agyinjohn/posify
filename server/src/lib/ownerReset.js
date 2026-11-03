import crypto from 'node:crypto';
import { SaleError } from './pricing.js';

/**
 * Lock-out recovery for the owner account. The recovery value (an environment variable on the host, or the
 * `npm run reset-owner` command) can only be set by someone who controls the server, which is what proves
 * they are the owner. Pure helpers live here so they can be unit tested.
 */

// A reset is applied once per distinct value. The fingerprint is remembered on the account, so leaving the
// environment variable in place after the owner chose their own password does NOT reset it again on every restart.
export const resetFingerprint = (password, secret) =>
  crypto.createHmac('sha256', String(secret)).update(String(password)).digest('hex');

// Which account to reset: the named one, or the only owner. Never guess between several owners.
export function pickOwner(owners, username) {
  if (username) {
    const hit = owners.find((u) => u.username === String(username).toLowerCase().trim());
    if (!hit) throw new SaleError(`No owner account named "${username}". Owners: ${owners.map((o) => o.username).join(', ') || 'none'}`);
    return hit;
  }
  if (owners.length === 0) throw new SaleError('There is no owner account to reset');
  if (owners.length > 1) {
    throw new SaleError(`There are ${owners.length} owners (${owners.map((o) => o.username).join(', ')}). Set RESET_OWNER_USERNAME to choose one`);
  }
  return owners[0];
}
