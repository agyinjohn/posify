import { SaleError } from './pricing.js';

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123',
  'iloveyou', 'admin123', 'welcome1', 'letmein1', '00000000', '11111111', 'abcd1234',
]);

/**
 * Password rules shared by sign-up, owner resets and self-service changes.
 * bcrypt only reads the first 72 bytes, so longer passwords are refused rather than silently cut short.
 */
export function checkPassword(password, username = '') {
  if (typeof password !== 'string' || password.length < 8) throw new SaleError('Password must be at least 8 characters');
  if (Buffer.byteLength(password) > 72) throw new SaleError('Password is too long (72 characters at most)');
  const lower = password.toLowerCase();
  if (username && lower === String(username).toLowerCase()) throw new SaleError('Password cannot be the same as the username');
  if (COMMON.has(lower)) throw new SaleError('That password is too easy to guess. Choose another');
  if (/^(.)\1+$/.test(password)) throw new SaleError('That password is too easy to guess. Choose another');
}

/**
 * A sign-in token is dead once the password changed after it was issued.
 * iat is in whole seconds; compare against the change time floored to seconds so a token minted
 * right after the change (same second) is still accepted.
 */
export function tokenRevoked(iat, passwordChangedAt) {
  if (!passwordChangedAt) return false;
  if (typeof iat !== 'number') return true; // tokens without an issue time predate this check
  return iat < Math.floor(new Date(passwordChangedAt).getTime() / 1000);
}
