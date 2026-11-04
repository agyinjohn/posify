import crypto from 'node:crypto';

// Reversible encryption for the one secret the platform admin is allowed to read back: a shop owner's temporary
// password, until the owner replaces it. AES-256-GCM with a key derived from the server's JWT secret.
const keyFrom = (secret) => crypto.createHash('sha256').update(`${secret}:temp-passwords`).digest();

export function seal(text, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function open(sealed, secret) {
  try {
    const [iv, tag, data] = String(sealed).split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key or tampered: never throw into a page
  }
}

// Readable temporary passwords: no look-alike characters, 12 long (~70 bits).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const tempPassword = (length = 12) => Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
